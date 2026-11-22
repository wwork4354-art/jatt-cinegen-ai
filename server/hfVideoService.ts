import { GoogleGenAI } from '@google/genai';
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
  if (hfVideoCache.size >= 6) {
    const oldestKey = hfVideoCache.keys().next().value;
    if (oldestKey) hfVideoCache.delete(oldestKey);
  }
  const id = crypto.randomUUID();
  hfVideoCache.set(id, { buffer, mimeType, createdAt: Date.now() });
  return id;
}

function parseDataUrlParts(dataUrl: string): { mimeType: string; base64: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || 'image/png';
  const base64 = match[2];
  return { mimeType, base64, buffer: Buffer.from(base64, 'base64') };
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const parsed = parseDataUrlParts(dataUrl);
  if (!parsed) return null;
  return new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mimeType });
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

function buildConnectOptions(hfToken?: string): { hf_token?: `hf_${string}`; token?: `hf_${string}` } | undefined {
  const trimmed = hfToken?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed as `hf_${string}`;
  return { hf_token: normalized, token: normalized };
}

async function connectSpaceFast(spaceId: string, hfToken?: string, timeoutMs = 8000): Promise<Client> {
  const options = buildConnectOptions(hfToken);
  return withTimeout(
    options ? Client.connect(spaceId, options) : Client.connect(spaceId),
    timeoutMs,
    `Quick-check ${spaceId}`
  );
}

async function downloadVideoBuffer(
  url: string,
  headers?: Record<string, string>,
  label = 'AI GPU'
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await withTimeout(fetch(url, headers ? { headers } : undefined), 28000, `Download MP4 from ${label}`);
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

// Engine 1: Google Veo (veo-2.0-generate-001) via official @google/genai SDK
async function tryGoogleVeoVideo(params: {
  apiKey: string;
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  imageDataUrl?: string;
  onProgress: (percent: number, message: string) => void;
  isAborted?: () => boolean;
}): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }> {
  const { apiKey, prompt, mode, aspectRatio, imageDataUrl, onProgress, isAborted } = params;
  onProgress(12, 'Routing to Google Veo 2.0 Video Engine...');

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const veoRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
  const parsedImage = mode === 'image-to-video' && imageDataUrl ? parseDataUrlParts(imageDataUrl) : null;

  let operation = await withTimeout(
    ai.models.generateVideos({
      model: 'veo-2.0-generate-001',
      prompt,
      ...(parsedImage
        ? {
            image: {
              imageBytes: parsedImage.base64,
              mimeType: parsedImage.mimeType,
            },
          }
        : {}),
      config: {
        aspectRatio: veoRatio,
        numberOfVideos: 1,
        personGeneration: 'allow_adult',
      },
    }),
    15000,
    'Google Veo request'
  );

  const startedAt = Date.now();
  while (!operation.done) {
    if (isAborted?.()) {
      throw new Error('Aborted');
    }
    if (Date.now() - startedAt > 65000) {
      throw new Error('Google Veo generation timed out');
    }
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(78, 25 + Math.round(elapsedSec * 0.8)), 'Generating cinematic video via Google Veo 2.0...');
    await new Promise((r) => setTimeout(r, 4000));
    operation = await withTimeout(
      ai.operations.getVideosOperation({ operation }),
      10000,
      'Google Veo poll'
    );
  }

  const generated = operation.response?.generatedVideos?.[0]?.video;
  if (generated?.videoBytes) {
    const buffer = Buffer.from(generated.videoBytes, 'base64');
    return {
      buffer,
      mimeType: generated.mimeType || 'video/mp4',
      width: veoRatio === '9:16' ? 720 : 1280,
      height: veoRatio === '9:16' ? 1280 : 720,
    };
  }
  if (generated?.uri) {
    onProgress(86, 'Downloading generated MP4 from Google Veo...');
    const downloaded = await downloadVideoBuffer(
      generated.uri,
      { 'x-goog-api-key': apiKey },
      'Google Veo'
    );
    return {
      ...downloaded,
      width: veoRatio === '9:16' ? 720 : 1280,
      height: veoRatio === '9:16' ? 1280 : 720,
    };
  }

  throw new Error('Google Veo returned no downloadable video');
}

// Engine 2A: SiliconFlow Free Credit API (Wan-AI/Wan2.1-T2V-14B / I2V-14B-720P)
async function trySiliconFlowWanVideo(params: {
  apiKey: string;
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  imageDataUrl?: string;
  onProgress: (percent: number, message: string) => void;
  isAborted?: () => boolean;
}): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }> {
  const { apiKey, prompt, mode, aspectRatio, imageDataUrl, onProgress, isAborted } = params;
  onProgress(22, 'Routing to Qwen Wan 2.1 (SiliconFlow API)...');

  const isI2v = mode === 'image-to-video' && Boolean(imageDataUrl);
  const imageSize =
    aspectRatio === '9:16' ? '720x1280' : aspectRatio === '1:1' ? '960x960' : '1280x720';
  const [wStr, hStr] = imageSize.split('x');
  const width = Number(wStr);
  const height = Number(hStr);

  const hosts = ['https://api.siliconflow.com', 'https://api.siliconflow.cn'];
  let activeHost = '';
  let requestId = '';

  for (const host of hosts) {
    try {
      const submitRes = await withTimeout(
        fetch(`${host}/v1/video/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: isI2v ? 'Wan-AI/Wan2.1-I2V-14B-720P' : 'Wan-AI/Wan2.1-T2V-14B',
            prompt,
            image_size: imageSize,
            ...(isI2v && imageDataUrl ? { image: imageDataUrl } : {}),
          }),
        }),
        10000,
        'SiliconFlow submit'
      );

      if (!submitRes.ok) {
        continue;
      }
      const data = (await submitRes.json()) as { requestId?: string };
      if (data.requestId) {
        activeHost = host;
        requestId = data.requestId;
        break;
      }
    } catch {
      // Try next SiliconFlow host
    }
  }

  if (!activeHost || !requestId) {
    throw new Error('SiliconFlow free credits unavailable or quota reached');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 55000) {
    if (isAborted?.()) {
      throw new Error('Aborted');
    }
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(82, 34 + elapsedSec), 'Generating Qwen Wan 2.1 motion frames...');

    await new Promise((r) => setTimeout(r, 3500));
    const statusRes = await withTimeout(
      fetch(`${activeHost}/v1/video/status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      }),
      8000,
      'SiliconFlow status'
    );

    if (!statusRes.ok) {
      throw new Error(`SiliconFlow status HTTP ${statusRes.status}`);
    }

    const statusData = (await statusRes.json()) as {
      status?: string;
      reason?: string;
      results?: { videos?: Array<{ url?: string }> };
    };

    if (statusData.status === 'Succeed') {
      const videoUrl = statusData.results?.videos?.[0]?.url;
      if (!videoUrl) {
        throw new Error('SiliconFlow completed without a video URL');
      }
      onProgress(88, 'Downloading generated MP4 from Qwen Wan 2.1...');
      const downloaded = await downloadVideoBuffer(videoUrl, undefined, 'Qwen Wan 2.1');
      return { ...downloaded, width, height };
    }

    if (statusData.status === 'Failed') {
      throw new Error(statusData.reason || 'SiliconFlow video job failed');
    }
  }

  throw new Error('SiliconFlow Wan 2.1 timed out');
}

async function runGradioJob(params: {
  spaceId: string;
  label: string;
  endpoint: string;
  payload: Record<string, unknown> | unknown[];
  hfToken?: string;
  onProgress: (percent: number, message: string) => void;
  existingClient?: Client;
  connectTimeoutMs?: number;
  quickQueueTimeoutMs?: number;
  jobTimeoutMs?: number;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const {
    spaceId,
    label,
    endpoint,
    payload,
    hfToken,
    onProgress,
    existingClient,
    connectTimeoutMs = 8000,
    quickQueueTimeoutMs = 8000,
    jobTimeoutMs = 55000,
  } = params;

  onProgress(24, `Quick-checking ${label} on Hugging Face...`);
  const client = existingClient ?? (await connectSpaceFast(spaceId, hfToken, connectTimeoutMs));

  onProgress(28, `Checking queue availability on ${label}...`);
  const submission = client.submit(endpoint, payload);

  const startedAt = Date.now();
  let hasStartedGenerating = false;
  let resultData: unknown = null;

  for await (const rawMsg of submission as AsyncIterable<Record<string, unknown>>) {
    const elapsed = Date.now() - startedAt;

    if (!hasStartedGenerating && elapsed > quickQueueTimeoutMs) {
      throw new Error(`${label} queue busy (8s quick-check limit)`);
    }
    if (elapsed > jobTimeoutMs) {
      throw new Error(`${label} GPU execution timed out`);
    }

    if (rawMsg.type === 'status') {
      const stage = String(rawMsg.stage || '');
      const msgText = typeof rawMsg.message === 'string' ? rawMsg.message : '';
      if (stage === 'error') {
        throw new Error(msgText || `${label} GPU returned an error`);
      }
      if (typeof rawMsg.eta === 'number' && rawMsg.eta > 45) {
        throw new Error(`${label} GPU queue wait too long (~${Math.round(rawMsg.eta)}s)`);
      }
      if (stage === 'generating') {
        hasStartedGenerating = true;
        onProgress(58, `Generating Real Motion Frames via ${label}...`);
      } else if (typeof rawMsg.position === 'number' && rawMsg.position > 0) {
        if (rawMsg.position > 5 && !hfToken?.trim()) {
          throw new Error(`${label} queue full (#${rawMsg.position})`);
        }
        onProgress(32, `Free GPU Queue (#${rawMsg.position}) on ${label}...`);
      } else {
        onProgress(36, `Preparing ${label} Free GPU...`);
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
  return downloadVideoBuffer(videoUrl, undefined, label);
}

function getSpaceDims(aspectRatio: HfAspectRatio): { width: number; height: number } {
  if (aspectRatio === '9:16') return { width: 512, height: 704 };
  if (aspectRatio === '1:1') return { width: 512, height: 512 };
  return { width: 704, height: 512 };
}

export async function generateSmartMultiEngineVideo(params: {
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  imageDataUrl?: string;
  geminiKey?: string;
  hfToken?: string;
  siliconFlowKey?: string;
  onEvent: (event: HfProgressEvent) => void;
  isAborted?: () => boolean;
}): Promise<void> {
  const {
    prompt,
    mode,
    aspectRatio,
    imageDataUrl,
    geminiKey,
    hfToken,
    siliconFlowKey,
    onEvent,
    isAborted,
  } = params;

  const { width, height } = getSpaceDims(aspectRatio);
  const imageBlob = mode === 'image-to-video' && imageDataUrl ? dataUrlToBlob(imageDataUrl) : null;

  const resolvedGeminiKey = (geminiKey?.trim() || process.env.VITE_GEMINI_API_KEY || '').trim();
  const resolvedHfToken = (hfToken?.trim() || process.env.VITE_HF_TOKEN || '').trim();
  const resolvedSiliconFlowKey = (
    siliconFlowKey?.trim() ||
    process.env.VITE_SILICONFLOW_KEY ||
    ''
  ).trim();

  const progressCb = (percent: number, message: string) => {
    if (!isAborted?.()) {
      onEvent({ type: 'progress', percent, message });
    }
  };

  const attempts: Array<{
    badge: string;
    run: () => Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }>;
  }> = [];

  // PRIORITY 1: Google Veo API (veo-2.0-generate-001)
  if (resolvedGeminiKey) {
    attempts.push({
      badge: 'Rendered via Google Veo',
      run: () =>
        tryGoogleVeoVideo({
          apiKey: resolvedGeminiKey,
          prompt,
          mode,
          aspectRatio,
          imageDataUrl,
          onProgress: progressCb,
          isAborted,
        }),
    });
  }

  // PRIORITY 2A: SiliconFlow Free Credit API (Qwen Wan-AI/Wan2.1-T2V-14B / I2V)
  if (resolvedSiliconFlowKey) {
    attempts.push({
      badge: 'Rendered via Qwen Wan 2.1',
      run: () =>
        trySiliconFlowWanVideo({
          apiKey: resolvedSiliconFlowKey,
          prompt,
          mode,
          aspectRatio,
          imageDataUrl,
          onProgress: progressCb,
          isAborted,
        }),
    });
  }

  // PRIORITY 2B: Hugging Face Qwen Wan 2.1 / Wan 2.1 Fast
  if (mode === 'image-to-video' && imageBlob) {
    attempts.push({
      badge: 'Rendered via Qwen Wan 2.1',
      run: async () => {
        const wanW = aspectRatio === '9:16' ? 512 : aspectRatio === '1:1' ? 512 : 896;
        const wanH = aspectRatio === '9:16' ? 896 : 512;
        const res = await runGradioJob({
          spaceId: 'multimodalart/wan2-1-fast',
          label: 'Qwen Wan 2.1',
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
          hfToken: resolvedHfToken,
          onProgress: progressCb,
        });
        return { ...res, width: wanW, height: wanH };
      },
    });
  } else {
    attempts.push({
      badge: 'Rendered via Qwen Wan 2.1',
      run: async () => {
        const client = await connectSpaceFast('Wan-AI/Wan2.1', resolvedHfToken, 8000);
        const apiInfo = (await withTimeout(client.view_api(), 5000, 'Inspect Wan2.1 API')) as {
          named_endpoints?: Record<string, unknown>;
        };
        const endpoints = Object.keys(apiInfo.named_endpoints ?? {});
        const preferred =
          endpoints.find((e) => e.includes('t2v') || e.includes('predict') || e.includes('generate')) ||
          endpoints[0];
        if (!preferred) {
          throw new Error('Wan-AI/Wan2.1 endpoint unavailable');
        }
        const res = await runGradioJob({
          spaceId: 'Wan-AI/Wan2.1',
          label: 'Qwen Wan 2.1',
          endpoint: preferred,
          payload: { prompt },
          hfToken: resolvedHfToken,
          existingClient: client,
          onProgress: progressCb,
        });
        return { ...res, width: 832, height: 480 };
      },
    });
  }

  // PRIORITY 2C: Lightricks/ltx-video-distilled
  attempts.push({
    badge: 'Rendered via LTX-Video GPU',
    run: async () => {
      const endpoint = mode === 'image-to-video' && imageBlob ? '/image_to_video' : '/text_to_video';
      const res = await runGradioJob({
        spaceId: 'Lightricks/ltx-video-distilled',
        label: 'LTX-Video Distilled',
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
        hfToken: resolvedHfToken,
        onProgress: progressCb,
      });
      return { ...res, width, height };
    },
  });

  // PRIORITY 2D: zai-org/CogVideoX-2b-space
  if (mode === 'text-to-video') {
    attempts.push({
      badge: 'Rendered via CogVideoX GPU',
      run: async () => {
        const res = await runGradioJob({
          spaceId: 'zai-org/CogVideoX-2b-space',
          label: 'CogVideoX-2B',
          endpoint: '/generate',
          payload: {
            prompt,
            num_inference_steps: 25,
            guidance_scale: 6,
          },
          hfToken: resolvedHfToken,
          onProgress: progressCb,
        });
        return { ...res, width: 720, height: 480 };
      },
    });
  }

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
        message: `${attempt.badge}!`,
        providerLabel: attempt.badge,
        videoApiPath: `/api/hf-video-file/${fileId}`,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      });
      return;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'Engine unavailable';
      if (i + 1 < attempts.length && !isAborted?.()) {
        onEvent({
          type: 'progress',
          percent: Math.min(35, 16 + i * 4),
          message: `Routing to next available AI engine...`,
        });
      }
    }
  }

  // PRIORITY 3 handoff to client CineGen Unlimited 3-Scene AI Reel
  if (!isAborted?.()) {
    onEvent({
      type: 'busy',
      message: `Cloud GPUs busy (${lastReason}) — switching to CineGen Unlimited Engine...`,
    });
  }
}
