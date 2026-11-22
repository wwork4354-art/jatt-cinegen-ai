import { Client, handle_file } from '@gradio/client';
import crypto from 'node:crypto';

export type HfVideoMode = 'text-to-video' | 'image-to-video';
export type HfAspectRatio = '16:9' | '9:16' | '1:1';

export interface HfProgressEvent {
  type: 'progress' | 'done' | 'busy';
  percent?: number;
  message: string;
  providerLabel?: string;
  videoApiPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

interface CachedVideoEntry {
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}

const hfVideoCache = new Map<string, CachedVideoEntry>();

export function getCachedHfVideo(id: string): CachedVideoEntry | undefined {
  const entry = hfVideoCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > 15 * 60 * 1000) {
    hfVideoCache.delete(id);
    return undefined;
  }
  return entry;
}

function storeCachedHfVideo(buffer: Buffer, mimeType: string): string {
  // Keep memory lean: cap cache at 6 recent MP4 files
  if (hfVideoCache.size >= 6) {
    const oldestKey = hfVideoCache.keys().next().value;
    if (oldestKey) hfVideoCache.delete(oldestKey);
  }
  const id = crypto.randomUUID();
  hfVideoCache.set(id, { buffer, mimeType, createdAt: Date.now() });
  return id;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const buf = Buffer.from(match[2], 'base64');
  return new Blob([buf], { type: mime });
}

function extractGradioVideoUrl(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === 'string') {
    if (payload.startsWith('http://') || payload.startsWith('https://')) {
      return payload;
    }
    return null;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractGradioVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (obj.video) {
      const fromVideo = extractGradioVideoUrl(obj.video);
      if (fromVideo) return fromVideo;
    }
    if (typeof obj.url === 'string' && obj.url.startsWith('http')) {
      return obj.url;
    }
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runGradioJob(params: {
  spaceId: string;
  label: string;
  endpoint: string;
  payload: Record<string, unknown> | unknown[];
  onProgress: (percent: number, message: string) => void;
  connectTimeoutMs?: number;
  jobTimeoutMs?: number;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const {
    spaceId,
    label,
    endpoint,
    payload,
    onProgress,
    connectTimeoutMs = 12000,
    jobTimeoutMs = 65000,
  } = params;

  onProgress(14, `Connecting to Free AI Video GPU (${label})...`);
  const client = await withTimeout(Client.connect(spaceId), connectTimeoutMs, `Connect ${spaceId}`);

  onProgress(24, `Submitting job to ${label} GPU...`);
  const submission = client.submit(endpoint, payload);

  const startedAt = Date.now();
  let resultData: unknown = null;

  for await (const rawMsg of submission as AsyncIterable<Record<string, unknown>>) {
    if (Date.now() - startedAt > jobTimeoutMs) {
      throw new Error(`${label} GPU queue exceeded wait limit`);
    }

    if (rawMsg.type === 'status') {
      const stage = String(rawMsg.stage || '');
      const msgText = typeof rawMsg.message === 'string' ? rawMsg.message : '';
      if (stage === 'error') {
        throw new Error(msgText || `${label} GPU returned an execution error`);
      }
      if (typeof rawMsg.eta === 'number' && rawMsg.eta > 85) {
        throw new Error(`${label} GPU queue wait too long (~${Math.round(rawMsg.eta)}s)`);
      }
      if (typeof rawMsg.position === 'number' && rawMsg.position > 0) {
        onProgress(36, `Waiting in Free GPU Queue (#${rawMsg.position}) on ${label}...`);
      } else if (stage === 'generating') {
        onProgress(62, `Generating Real Motion Frames on ${label}...`);
      } else {
        onProgress(45, `Processing on ${label} Free GPU...`);
      }
    } else if (rawMsg.type === 'data') {
      resultData = rawMsg.data;
      break;
    }
  }

  const videoUrl = extractGradioVideoUrl(resultData);
  if (!videoUrl) {
    throw new Error(`${label} did not return a valid MP4 video stream`);
  }

  onProgress(86, `Downloading generated MP4 from ${label}...`);
  const res = await withTimeout(fetch(videoUrl), 25000, `Download MP4 from ${label}`);
  if (!res.ok) {
    throw new Error(`Failed to download generated MP4 (HTTP ${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength < 8000) {
    throw new Error(`${label} returned an empty video file`);
  }

  const contentType = (res.headers.get('content-type') || 'video/mp4').split(';')[0];
  const mimeType = contentType.startsWith('video/') ? contentType : 'video/mp4';
  return { buffer, mimeType };
}

function getSpaceDims(aspectRatio: HfAspectRatio): { width: number; height: number } {
  if (aspectRatio === '9:16') return { width: 512, height: 704 };
  if (aspectRatio === '1:1') return { width: 512, height: 512 };
  return { width: 704, height: 512 };
}

export async function generateHfRealAiVideo(params: {
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  imageDataUrl?: string;
  onEvent: (event: HfProgressEvent) => void;
  isAborted?: () => boolean;
}): Promise<void> {
  const { prompt, mode, aspectRatio, imageDataUrl, onEvent, isAborted } = params;
  const { width, height } = getSpaceDims(aspectRatio);
  const imageBlob = mode === 'image-to-video' && imageDataUrl ? dataUrlToBlob(imageDataUrl) : null;

  const progressCb = (percent: number, message: string) => {
    if (!isAborted?.()) {
      onEvent({ type: 'progress', percent, message });
    }
  };

  const attempts: Array<{
    name: string;
    run: () => Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }>;
  }> = [
    // Primary: Lightricks/ltx-video-distilled
    {
      name: 'LTX-Video Distilled (Free HF GPU)',
      run: async () => {
        const endpoint = mode === 'image-to-video' && imageBlob ? '/image_to_video' : '/text_to_video';
        const res = await runGradioJob({
          spaceId: 'Lightricks/ltx-video-distilled',
          label: 'LTX-Video',
          endpoint,
          payload: {
            prompt,
            negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
            input_image_filepath: mode === 'image-to-video' && imageBlob ? handle_file(imageBlob) : null,
            input_video_filepath: null,
            height_ui: height,
            width_ui: width,
            mode: mode === 'image-to-video' && imageBlob ? 'image-to-video' : 'text-to-video',
            duration_ui: 3,
            ui_frames_to_use: 9,
            seed_ui: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            ui_guidance_scale: 1,
            improve_texture_flag: true,
          },
          onProgress: progressCb,
        });
        return { ...res, width, height };
      },
    },
  ];

  // Backup 1: Wan-AI/Wan2.1 (plus multimodalart/wan2-1-fast for Image-to-Video)
  if (mode === 'image-to-video' && imageBlob) {
    attempts.push({
      name: 'Wan 2.1 Fast I2V (Free HF GPU)',
      run: async () => {
        const wanW = aspectRatio === '9:16' ? 512 : aspectRatio === '1:1' ? 512 : 896;
        const wanH = aspectRatio === '9:16' ? 896 : 512;
        const res = await runGradioJob({
          spaceId: 'multimodalart/wan2-1-fast',
          label: 'Wan 2.1 Fast',
          endpoint: '/generate_video',
          payload: {
            input_image: handle_file(imageBlob),
            prompt,
            height: wanH,
            width: wanW,
            duration_seconds: 3,
            guidance_scale: 1,
            steps: 4,
            seed: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
          },
          onProgress: progressCb,
        });
        return { ...res, width: wanW, height: wanH };
      },
    });
  }

  attempts.push({
    name: 'Wan-AI/Wan2.1 (Free HF GPU)',
    run: async () => {
      const client = await withTimeout(Client.connect('Wan-AI/Wan2.1'), 10000, 'Connect Wan-AI/Wan2.1');
      const apiInfo = (await client.view_api()) as {
        named_endpoints?: Record<string, { parameters?: Array<{ parameter_name?: string }> }>;
      };
      const endpoints = Object.keys(apiInfo.named_endpoints ?? {});
      const preferred =
        endpoints.find((e) =>
          mode === 'image-to-video'
            ? e.includes('i2v') || e.includes('image') || e.includes('generate')
            : e.includes('t2v') || e.includes('predict') || e.includes('generate')
        ) || endpoints[0];

      if (!preferred) {
        throw new Error('Wan-AI/Wan2.1 has no active prediction endpoint');
      }
      const res = await runGradioJob({
        spaceId: 'Wan-AI/Wan2.1',
        label: 'Wan 2.1',
        endpoint: preferred,
        payload:
          mode === 'image-to-video' && imageBlob
            ? { prompt, image: handle_file(imageBlob) }
            : { prompt },
        onProgress: progressCb,
      });
      return { ...res, width: 832, height: 480 };
    },
  });

  // Backup 2: zai-org/CogVideoX-5B-Space
  attempts.push({
    name: 'CogVideoX-5B (Free HF GPU)',
    run: async () => {
      const res = await runGradioJob({
        spaceId: 'zai-org/CogVideoX-5B-Space',
        label: 'CogVideoX-5B',
        endpoint: '/generate',
        payload: {
          prompt,
          image_input: imageBlob ? handle_file(imageBlob) : null,
          video_input: null,
          video_strength: 0.8,
          seed_value: -1,
          scale_status: false,
          rife_status: false,
        },
        onProgress: progressCb,
      });
      return { ...res, width: 720, height: 480 };
    },
  });

  // Backup 2b: hpcai-tech/Open-Sora
  attempts.push({
    name: 'Open-Sora (Free HF GPU)',
    run: async () => {
      const client = await withTimeout(Client.connect('hpcai-tech/Open-Sora'), 10000, 'Connect Open-Sora');
      const apiInfo = (await client.view_api()) as {
        named_endpoints?: Record<string, unknown>;
      };
      const endpoints = Object.keys(apiInfo.named_endpoints ?? {});
      const preferred =
        endpoints.find((e) => e.includes('predict') || e.includes('generate')) || endpoints[0];
      if (!preferred) {
        throw new Error('Open-Sora Space has no active endpoint');
      }
      const res = await runGradioJob({
        spaceId: 'hpcai-tech/Open-Sora',
        label: 'Open-Sora',
        endpoint: preferred,
        payload: { prompt },
        onProgress: progressCb,
      });
      return { ...res, width: 720, height: 480 };
    },
  });

  let lastReason = '';

  for (let i = 0; i < attempts.length; i += 1) {
    if (isAborted?.()) return;
    const attempt = attempts[i];
    try {
      const result = await attempt.run();
      if (isAborted?.()) return;
      const fileId = storeCachedHfVideo(result.buffer, result.mimeType);
      onEvent({
        type: 'done',
        percent: 100,
        message: 'Real AI motion video ready!',
        providerLabel: attempt.name,
        videoApiPath: `/api/hf-video-file/${fileId}`,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      });
      return;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'GPU queue busy';
      if (i + 1 < attempts.length && !isAborted?.()) {
        onEvent({
          type: 'progress',
          percent: 18,
          message: `Free GPU busy (${attempt.name}) — switching to backup Space...`,
        });
      }
    }
  }

  if (!isAborted?.()) {
    onEvent({
      type: 'busy',
      message: `Free GPU busy — retrying or switch to Fast 3-Scene Reel (${lastReason})`,
    });
  }
}
