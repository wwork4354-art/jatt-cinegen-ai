import { GoogleGenAI } from '@google/genai';
import { Client, handle_file } from '@gradio/client';
import { InferenceClient } from '@huggingface/inference';
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
const refImageCache = new Map<string, CachedVideoEntry>();

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

export function getCachedRefImage(id: string): CachedVideoEntry | undefined {
  const entry = refImageCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
    refImageCache.delete(id);
    return undefined;
  }
  return entry;
}

function storeCachedRefImage(buffer: Buffer, mimeType: string): string {
  if (refImageCache.size >= 10) {
    const oldestKey = refImageCache.keys().next().value;
    if (oldestKey) refImageCache.delete(oldestKey);
  }
  const id = crypto.randomUUID();
  refImageCache.set(id, { buffer, mimeType, createdAt: Date.now() });
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
    connectTimeoutMs = 7000,
    quickQueueTimeoutMs = hfToken?.trim() ? 14000 : 8000,
    jobTimeoutMs = 28000,
  } = params;

  onProgress(22, `Connecting to ${label} (16fps fast GPU)...`);
  const client = existingClient ?? (await connectSpaceFast(spaceId, hfToken, connectTimeoutMs));

  onProgress(28, `Submitting fast clip to ${label} GPU...`);
  const submission = client.submit(endpoint, payload) as AsyncIterable<Record<string, unknown>> & {
    cancel?: () => Promise<void> | void;
  };

  const startedAt = Date.now();
  let hasStartedGenerating = false;
  let resultData: unknown = null;
  let lastPercent = 30;
  let settled = false;

  const consumePromise = new Promise<unknown>((resolve, reject) => {
    let watchdogTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      settled = true;
      if (watchdogTimer) clearInterval(watchdogTimer);
    };

    const abortJob = (reason: string) => {
      if (settled) return;
      cleanup();
      try {
        void Promise.resolve(submission.cancel?.()).catch(() => {});
      } catch {
        // Ignore cancel errors
      }
      reject(new Error(reason));
    };

    // Active wall-clock watchdog so silent Gradio SSE queues NEVER freeze at 35%
    watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (!hasStartedGenerating && elapsed > quickQueueTimeoutMs) {
        abortJob(`${label} queue busy (${Math.round(quickQueueTimeoutMs / 1000)}s limit)`);
        return;
      }
      if (elapsed > jobTimeoutMs) {
        abortJob(`${label} exceeded fast ${Math.round(jobTimeoutMs / 1000)}s GPU budget`);
        return;
      }
      // Smoothly advance indicator while waiting so UI never appears stuck
      lastPercent = Math.min(hasStartedGenerating ? 82 : 44, lastPercent + 2);
      onProgress(
        lastPercent,
        hasStartedGenerating
          ? `Generating fast 16fps frames via ${label}...`
          : `Waiting for ${label} GPU slot (${Math.round(elapsed / 1000)}s)...`
      );
    }, 1500);

    (async () => {
      try {
        for await (const rawMsg of submission) {
          if (settled) break;
          if (rawMsg.type === 'status') {
            const stage = String(rawMsg.stage || '');
            const msgText = typeof rawMsg.message === 'string' ? rawMsg.message : '';
            if (stage === 'error') {
              abortJob(msgText || `${label} GPU returned an error`);
              return;
            }
            if (typeof rawMsg.eta === 'number' && rawMsg.eta > 35) {
              abortJob(`${label} queue wait too long (~${Math.round(rawMsg.eta)}s)`);
              return;
            }
            if (stage === 'generating') {
              hasStartedGenerating = true;
              lastPercent = Math.max(lastPercent, 58);
              onProgress(lastPercent, `Generating fast 16fps AI clip via ${label}...`);
            } else if (typeof rawMsg.position === 'number' && rawMsg.position > 0) {
              if (rawMsg.position > 6 && !hfToken?.trim()) {
                abortJob(`${label} queue busy (#${rawMsg.position})`);
                return;
              }
              lastPercent = Math.max(lastPercent, 36);
              onProgress(lastPercent, `GPU Queue (#${rawMsg.position}) on ${label}...`);
            } else {
              lastPercent = Math.max(lastPercent, 38);
              onProgress(lastPercent, `Processing on ${label} GPU...`);
            }
          } else if (rawMsg.type === 'data') {
            cleanup();
            resolve(rawMsg.data);
            return;
          }
        }
        if (!settled) {
          abortJob(`${label} closed without returning video`);
        }
      } catch (err) {
        abortJob(err instanceof Error ? err.message : `${label} stream failed`);
      }
    })();
  });

  resultData = await consumePromise;

  const videoUrl = extractGradioVideoUrl(resultData);
  if (!videoUrl) {
    throw new Error(`${label} did not return a valid MP4 video stream`);
  }

  onProgress(88, `Downloading fast MP4 clip from ${label}...`);
  return downloadVideoBuffer(videoUrl, undefined, label);
}

// Engine 1A: Pollinations.ai Video API (gen.pollinations.ai/video with seedance -> wan -> veo + image[0] + optional ?key=)
async function tryPollinationsVideo(params: {
  prompt: string;
  aspectRatio: HfAspectRatio;
  referenceImageUrl?: string;
  pollinationsKey?: string;
  timeoutMs: number;
  onProgress: (percent: number, message: string) => void;
  isAborted?: () => boolean;
}): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number; modelUsed: string }> {
  const {
    prompt,
    aspectRatio,
    referenceImageUrl,
    pollinationsKey,
    timeoutMs,
    onProgress,
    isAborted,
  } = params;

  const width = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 768 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 768 : 720;
  const keyParam = pollinationsKey ? `&key=${encodeURIComponent(pollinationsKey)}` : '';
  const imageParam = referenceImageUrl
    ? `&image[0]=${encodeURIComponent(referenceImageUrl)}`
    : '';

  const modelsToTry = ['seedance-2.0', 'seedance-2.5-flash', 'wan-fast', 'wan', 'veo'];
  let lastError = 'Pollinations Video unavailable';

  for (let idx = 0; idx < modelsToTry.length; idx += 1) {
    if (isAborted?.()) throw new Error('Aborted');
    const model = modelsToTry[idx];
    onProgress(
      14 + idx * 5,
      `Generating real 5s MP4 via Pollinations.ai (${model})...`
    );

    const url = `https://gen.pollinations.ai/video/${encodeURIComponent(
      prompt
    )}?model=${encodeURIComponent(model)}&duration=5&aspectRatio=${encodeURIComponent(
      aspectRatio
    )}${imageParam}${keyParam}`;

    const perAttemptMs = Math.min(28000, Math.max(8000, timeoutMs - idx * 2000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttemptMs);

    try {
      const headers: Record<string, string> = {};
      if (pollinationsKey) {
        headers.Authorization = `Bearer ${pollinationsKey}`;
      }
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        let upstreamDetail = '';
        try {
          const errJson = (await res.json()) as { error?: { message?: string } | string; message?: string };
          upstreamDetail =
            typeof errJson.error === 'string'
              ? errJson.error
              : errJson.error?.message || errJson.message || '';
        } catch {
          // Ignore JSON parse error
        }

        if (res.status === 402) {
          throw new Error(
            upstreamDetail ||
              'Pollinations.ai paid balance is $0.00 (video models require paid pollen balance at enter.pollinations.ai)'
          );
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            upstreamDetail ||
              `Pollinations.ai Video authentication required (HTTP ${res.status})`
          );
        }
        lastError = upstreamDetail || `Pollinations Video (${model}) HTTP ${res.status}`;
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
        lastError = `Pollinations Video (${model}) returned ${contentType || 'non-video'}`;
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < 8000) {
        lastError = `Pollinations Video (${model}) returned empty clip`;
        continue;
      }

      return {
        buffer,
        mimeType: contentType.startsWith('video/') ? contentType.split(';')[0] : 'video/mp4',
        width,
        height,
        modelUsed: model,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Pollinations (${model}) failed`;
      if (
        lastError.includes('paid balance') ||
        lastError.includes('top-up') ||
        lastError.includes('HTTP 401') ||
        lastError.includes('HTTP 402') ||
        lastError.includes('HTTP 403')
      ) {
        throw new Error(lastError);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

// Engine: Active Hugging Face Inference API via @huggingface/inference (router.huggingface.co providers)
async function tryHuggingFaceInferenceVideo(params: {
  hfToken: string;
  modelId: string;
  provider?: 'auto' | 'fal-ai' | 'wavespeed' | 'hf-inference';
  label: string;
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  imageBlob?: Blob | null;
  timeoutMs: number;
  onProgress: (percent: number, message: string) => void;
  isAborted?: () => boolean;
}): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }> {
  const {
    hfToken,
    modelId,
    provider = 'auto',
    label,
    prompt,
    mode,
    aspectRatio,
    imageBlob,
    timeoutMs,
    onProgress,
    isAborted,
  } = params;
  onProgress(
    28,
    mode === 'image-to-video'
      ? `Animating reference photo via HF Inference API (${label})...`
      : `Generating real motion video via HF Inference API (${label})...`
  );

  const width = aspectRatio === '9:16' ? 480 : aspectRatio === '1:1' ? 512 : 768;
  const height = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 512 : 448;

  const controller = new AbortController();
  const effectiveTimeout = Math.min(34000, Math.max(8000, timeoutMs));
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    if (isAborted?.()) throw new Error('Aborted');
    const client = new InferenceClient(hfToken);

    let videoBlob: Blob;
    if (mode === 'image-to-video' && imageBlob) {
      videoBlob = await withTimeout(
        client.imageToVideo(
          {
            model: modelId,
            provider,
            inputs: imageBlob,
            parameters: {
              prompt,
              num_inference_steps: 20,
              guidance_scale: 5.0,
            },
          },
          { signal: controller.signal }
        ),
        effectiveTimeout,
        label
      );
    } else {
      videoBlob = await withTimeout(
        client.textToVideo(
          {
            model: modelId,
            provider,
            inputs: prompt,
            parameters: {
              num_frames: 41,
              num_inference_steps: 20,
              guidance_scale: modelId.includes('LTX') ? 3.0 : 5.0,
            },
          },
          { signal: controller.signal }
        ),
        effectiveTimeout,
        label
      );
    }

    const buffer = Buffer.from(await videoBlob.arrayBuffer());
    if (buffer.byteLength < 8000) {
      throw new Error(`${label} returned an empty video payload`);
    }

    const contentType = (videoBlob.type || '').toLowerCase();
    return {
      buffer,
      mimeType: contentType.startsWith('video/') ? contentType.split(';')[0] : 'video/mp4',
      width,
      height,
    };
  } finally {
    clearTimeout(timer);
  }
}

function getSpaceDims(aspectRatio: HfAspectRatio): { width: number; height: number } {
  // Fast compact dimensions (multiples of 32) for crisp 5s clips within budget
  if (aspectRatio === '9:16') return { width: 384, height: 640 };
  if (aspectRatio === '1:1') return { width: 512, height: 512 };
  return { width: 640, height: 384 };
}

export async function generateSmartMultiEngineVideo(params: {
  prompt: string;
  mode: HfVideoMode;
  aspectRatio: HfAspectRatio;
  duration?: '5s' | '10s' | '15s';
  imageDataUrl?: string;
  publicOrigin?: string;
  geminiKey?: string;
  hfToken?: string;
  siliconFlowKey?: string;
  pollinationsKey?: string;
  onEvent: (event: HfProgressEvent) => void;
  isAborted?: () => boolean;
}): Promise<void> {
  const {
    prompt,
    mode,
    aspectRatio,
    imageDataUrl,
    publicOrigin,
    geminiKey,
    hfToken,
    siliconFlowKey,
    pollinationsKey,
    onEvent,
    isAborted,
  } = params;

  const { width, height } = getSpaceDims(aspectRatio);
  const imageBlob = mode === 'image-to-video' && imageDataUrl ? dataUrlToBlob(imageDataUrl) : null;

  // Resolve public image[0] URL for Pollinations Video API (supports both https:// URLs and uploaded images)
  let resolvedRefImageUrl: string | undefined;
  if (mode === 'image-to-video' && imageDataUrl) {
    if (imageDataUrl.startsWith('http://') || imageDataUrl.startsWith('https://')) {
      resolvedRefImageUrl = imageDataUrl;
    } else if (publicOrigin && /^https?:\/\//i.test(publicOrigin)) {
      const parsed = parseDataUrlParts(imageDataUrl);
      if (parsed) {
        const refId = storeCachedRefImage(parsed.buffer, parsed.mimeType);
        resolvedRefImageUrl = `${publicOrigin.replace(/\/$/, '')}/api/hf-video-ref/${refId}`;
      }
    }
  }

  const resolvedGeminiKey = (geminiKey?.trim() || process.env.VITE_GEMINI_API_KEY || '').trim();
  const resolvedHfToken = (hfToken?.trim() || process.env.VITE_HF_TOKEN || process.env.HF_TOKEN || '').trim();
  const resolvedSiliconFlowKey = (
    siliconFlowKey?.trim() ||
    process.env.VITE_SILICONFLOW_KEY ||
    ''
  ).trim();
  const resolvedPollinationsKey = (
    pollinationsKey?.trim() ||
    process.env.VITE_POLLINATIONS_KEY ||
    process.env.VITE_POLLINATIONS_API_KEY ||
    process.env.POLLINATIONS_API_KEY ||
    ''
  ).trim();

  const cloudRouterDeadline = Date.now() + 64000;
  const remainingBudget = () => Math.max(4000, cloudRouterDeadline - Date.now());

  const progressCb = (percent: number, message: string) => {
    if (!isAborted?.()) {
      onEvent({ type: 'progress', percent, message });
    }
  };

  const attempts: Array<{
    badge: string;
    run: () => Promise<{ buffer: Buffer; mimeType: string; width: number; height: number; badgeOverride?: string }>;
  }> = [];

  // PRIORITY 1: SiliconFlow Video API (Qwen Wan-AI/Wan2.1-T2V-14B / I2V-14B-720P) — real character & scene motion
  if (resolvedSiliconFlowKey) {
    attempts.push({
      badge: 'Rendered via Qwen Wan 2.1 (SiliconFlow)',
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

  // PRIORITY 2: Hugging Face Inference Providers Router (Wan2.1, CogVideoX-5b, LTX-Video) — real character & object motion
  if (resolvedHfToken) {
    if (mode === 'image-to-video' && imageBlob) {
      attempts.push({
        badge: 'Rendered via HF Inference (Wan2.1-I2V)',
        run: () =>
          tryHuggingFaceInferenceVideo({
            hfToken: resolvedHfToken,
            modelId: 'Wan-AI/Wan2.1-I2V-14B-720P',
            provider: 'auto',
            label: 'Wan2.1-I2V-14B',
            prompt,
            mode,
            aspectRatio,
            imageBlob,
            timeoutMs: remainingBudget(),
            onProgress: progressCb,
            isAborted,
          }),
      });
    } else {
      attempts.push({
        badge: 'Rendered via HF Inference (Wan2.1-1.3B)',
        run: () =>
          tryHuggingFaceInferenceVideo({
            hfToken: resolvedHfToken,
            modelId: 'Wan-AI/Wan2.1-T2V-1.3B',
            provider: 'auto',
            label: 'Wan-AI/Wan2.1-T2V-1.3B',
            prompt,
            mode,
            aspectRatio,
            timeoutMs: remainingBudget(),
            onProgress: progressCb,
            isAborted,
          }),
      });

      attempts.push({
        badge: 'Rendered via HF Inference (Wan2.1-14B)',
        run: () =>
          tryHuggingFaceInferenceVideo({
            hfToken: resolvedHfToken,
            modelId: 'Wan-AI/Wan2.1-T2V-14B',
            provider: 'auto',
            label: 'Wan-AI/Wan2.1-T2V-14B',
            prompt,
            mode,
            aspectRatio,
            timeoutMs: remainingBudget(),
            onProgress: progressCb,
            isAborted,
          }),
      });

      attempts.push({
        badge: 'Rendered via HF Inference (CogVideoX-5b)',
        run: () =>
          tryHuggingFaceInferenceVideo({
            hfToken: resolvedHfToken,
            modelId: 'zai-org/CogVideoX-5b',
            provider: 'auto',
            label: 'zai-org/CogVideoX-5b',
            prompt,
            mode,
            aspectRatio,
            timeoutMs: remainingBudget(),
            onProgress: progressCb,
            isAborted,
          }),
      });

      attempts.push({
        badge: 'Rendered via HF Inference (LTX-Video)',
        run: () =>
          tryHuggingFaceInferenceVideo({
            hfToken: resolvedHfToken,
            modelId: 'Lightricks/LTX-Video-0.9.5',
            provider: 'auto',
            label: 'Lightricks/LTX-Video-0.9.5',
            prompt,
            mode,
            aspectRatio,
            timeoutMs: remainingBudget(),
            onProgress: progressCb,
            isAborted,
          }),
      });
    }
  }

  // PRIORITY 3: Google Veo 2.0 (veo-2.0-generate-001) when configured
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

  // PRIORITY 4: Live Hugging Face Gradio GPUs (Real Text-to-Video & Image-to-Video MP4)
  if (mode === 'image-to-video' && imageBlob) {
    attempts.push({
      badge: 'Rendered via LTX-Video GPU',
      run: async () => {
        onEvent({
          type: 'progress',
          percent: 38,
          message: 'Generating crisp 5s MP4 via Lightricks/LTX-Video...',
        });
        const budget = remainingBudget();
        const res = await runGradioJob({
          spaceId: 'Lightricks/ltx-video-distilled',
          label: 'LTX-Video Distilled',
          endpoint: '/image_to_video',
          payload: {
            prompt,
            negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
            input_image_filepath: handle_file(imageBlob),
            input_video_filepath: null,
            height_ui: height,
            width_ui: width,
            mode: 'image-to-video',
            duration_ui: 5,
            ui_frames_to_use: 9,
            seed_ui: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            ui_guidance_scale: 1,
            improve_texture_flag: false,
          },
          hfToken: resolvedHfToken,
          connectTimeoutMs: 7000,
          quickQueueTimeoutMs: Math.min(12000, budget),
          jobTimeoutMs: Math.min(26000, budget),
          onProgress: progressCb,
        });
        return { ...res, width, height };
      },
    });

    attempts.push({
      badge: 'Rendered via Qwen Wan 2.1',
      run: async () => {
        const wanW = aspectRatio === '9:16' ? 480 : aspectRatio === '1:1' ? 512 : 768;
        const wanH = aspectRatio === '9:16' ? 768 : 480;
        const budget = remainingBudget();
        const res = await runGradioJob({
          spaceId: 'multimodalart/wan2-1-fast',
          label: 'Qwen Wan 2.1',
          endpoint: '/generate_video',
          payload: {
            input_image: handle_file(imageBlob),
            prompt,
            height: wanH,
            width: wanW,
            negative_prompt: 'blurry, static, jittery, distorted, watermark, text, low quality',
            duration_seconds: 5,
            guidance_scale: 1,
            steps: 4,
            seed: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
          },
          hfToken: resolvedHfToken,
          connectTimeoutMs: 7000,
          quickQueueTimeoutMs: Math.min(11000, budget),
          jobTimeoutMs: Math.min(24000, budget),
          onProgress: progressCb,
        });
        return { ...res, width: wanW, height: wanH };
      },
    });

    attempts.push({
      badge: 'Rendered via Stable Video Diffusion GPU',
      run: async () => {
        const budget = remainingBudget();
        const res = await runGradioJob({
          spaceId: 'stabilityai/stable-video-diffusion',
          label: 'Stable Video Diffusion',
          endpoint: '/video',
          payload: {
            image: handle_file(imageBlob),
            seed: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            motion_bucket_id: 127,
            fps_id: 16,
          },
          hfToken: resolvedHfToken,
          connectTimeoutMs: 7000,
          quickQueueTimeoutMs: Math.min(10000, budget),
          jobTimeoutMs: Math.min(22000, budget),
          onProgress: progressCb,
        });
        return { ...res, width: 1024, height: 576 };
      },
    });
  } else {
    attempts.push({
      badge: 'Rendered via LTX-Video GPU',
      run: async () => {
        const budget = remainingBudget();
        const res = await runGradioJob({
          spaceId: 'Lightricks/ltx-video-distilled',
          label: 'LTX-Video Distilled',
          endpoint: '/text_to_video',
          payload: {
            prompt,
            negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
            input_image_filepath: null,
            input_video_filepath: null,
            height_ui: height,
            width_ui: width,
            mode: 'text-to-video',
            duration_ui: 5,
            ui_frames_to_use: 9,
            seed_ui: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            ui_guidance_scale: 1,
            improve_texture_flag: false,
          },
          hfToken: resolvedHfToken,
          connectTimeoutMs: 7000,
          quickQueueTimeoutMs: Math.min(12000, budget),
          jobTimeoutMs: Math.min(26000, budget),
          onProgress: progressCb,
        });
        return { ...res, width, height };
      },
    });

    attempts.push({
      badge: 'Rendered via CogVideoX GPU',
      run: async () => {
        const budget = remainingBudget();
        const res = await runGradioJob({
          spaceId: 'zai-org/CogVideoX-2b-space',
          label: 'CogVideoX-2B',
          endpoint: '/generate',
          payload: {
            prompt,
            num_inference_steps: 18,
            guidance_scale: 6,
          },
          hfToken: resolvedHfToken,
          connectTimeoutMs: 7000,
          quickQueueTimeoutMs: Math.min(11000, budget),
          jobTimeoutMs: Math.min(24000, budget),
          onProgress: progressCb,
        });
        return { ...res, width: 720, height: 480 };
      },
    });
  }

  // PRIORITY 5: Pollinations.ai Video API only if key is configured and real HF/SiliconFlow/Veo APIs failed
  if (resolvedPollinationsKey) {
    attempts.push({
      badge: 'Rendered via Pollinations.ai Video',
      run: async () => {
        const res = await tryPollinationsVideo({
          prompt,
          aspectRatio,
          referenceImageUrl: resolvedRefImageUrl,
          pollinationsKey: resolvedPollinationsKey,
          timeoutMs: Math.min(20000, remainingBudget()),
          onProgress: progressCb,
          isAborted,
        });
        return {
          buffer: res.buffer,
          mimeType: res.mimeType,
          width: res.width,
          height: res.height,
          badgeOverride: `Rendered via Pollinations.ai (${res.modelUsed})`,
        };
      },
    });
  }

  let lastReason = 'Real Text-to-Video APIs are currently unavailable or busy';

  for (let i = 0; i < attempts.length; i += 1) {
    if (isAborted?.()) return;
    if (Date.now() > cloudRouterDeadline - 2000) {
      lastReason = 'Cloud video generation timeout reached';
      break;
    }
    const attempt = attempts[i];
    try {
      const result = await withTimeout(attempt.run(), remainingBudget(), attempt.badge);
      if (isAborted?.()) return;
      const finalBadge = result.badgeOverride || attempt.badge;
      const fileId = storeCachedHfVideo(result.buffer, result.mimeType);
      onEvent({
        type: 'done',
        percent: 100,
        message: `${finalBadge}!`,
        providerLabel: finalBadge,
        videoApiPath: `/api/hf-video-file/${fileId}`,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      });
      return;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'Video endpoint unavailable';
      if (i + 1 < attempts.length && Date.now() <= cloudRouterDeadline - 3000 && !isAborted?.()) {
        onEvent({
          type: 'progress',
          percent: Math.min(54, 20 + i * 7),
          message: `${lastReason} — trying next real Text-to-Video model...`,
        });
      }
    }
  }

  if (!isAborted?.()) {
    onEvent({
      type: 'busy',
      message: `${lastReason} — switching to animated Pollinations AI fallback...`,
    });
  }
}

interface GradioParamInfo {
  parameter_name?: string;
  label?: string;
  component?: string;
  parameter_default?: unknown;
}

function mapLipSyncPayload(
  parameters: GradioParamInfo[] | undefined,
  imageBlob: Blob,
  audioBlob: Blob
): Record<string, unknown> | unknown[] {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return [handle_file(imageBlob), handle_file(audioBlob)];
  }

  const objPayload: Record<string, unknown> = {};
  let hasNamedKeys = true;
  let placedImage = false;
  let placedAudio = false;

  for (const param of parameters) {
    const key = param.parameter_name?.trim();
    if (!key) {
      hasNamedKeys = false;
      break;
    }
    const hint = `${key} ${param.label ?? ''} ${param.component ?? ''}`.toLowerCase();

    if (
      !placedImage &&
      (hint.includes('image') ||
        hint.includes('portrait') ||
        hint.includes('face') ||
        hint.includes('source'))
    ) {
      objPayload[key] = handle_file(imageBlob);
      placedImage = true;
    } else if (
      !placedAudio &&
      (hint.includes('audio') ||
        hint.includes('voice') ||
        hint.includes('speech') ||
        hint.includes('driven'))
    ) {
      objPayload[key] = handle_file(audioBlob);
      placedAudio = true;
    } else if (key === 'preprocess') {
      objPayload[key] = 'crop';
    } else if (key === 'still_mode' || key === 'still') {
      objPayload[key] = true;
    } else if (key === 'use_enhancer') {
      objPayload[key] = false;
    } else if (key === 'size_of_image' || key === 'size') {
      objPayload[key] = 256;
    } else if (param.parameter_default !== undefined) {
      objPayload[key] = param.parameter_default;
    }
  }

  if (hasNamedKeys && placedImage && placedAudio) {
    return objPayload;
  }

  return [handle_file(imageBlob), handle_file(audioBlob)];
}

export async function generateLipSyncVideo(params: {
  imageDataUrl: string;
  audioDataUrl: string;
  hfToken?: string;
  onEvent: (event: HfProgressEvent) => void;
  isAborted?: () => boolean;
}): Promise<void> {
  const { imageDataUrl, audioDataUrl, hfToken, onEvent, isAborted } = params;
  const resolvedHfToken = (hfToken?.trim() || process.env.VITE_HF_TOKEN || '').trim();

  const imageBlob = dataUrlToBlob(imageDataUrl);
  const audioBlob = dataUrlToBlob(audioDataUrl);

  if (!imageBlob || !audioBlob) {
    onEvent({
      type: 'busy',
      message: 'Switching to CineGen Smart Lip-Sync Animator...',
    });
    return;
  }

  const progressCb = (percent: number, message: string) => {
    if (!isAborted?.()) {
      onEvent({ type: 'progress', percent, message });
    }
  };

  const spaces = [
    { spaceId: 'fffiloni/SadTalker', label: 'SadTalker Lip-Sync GPU' },
    { spaceId: 'vinthony/SadTalker', label: 'SadTalker v2 GPU' },
    { spaceId: 'fudan-generative-ai/hallo', label: 'HallO Portrait GPU' },
    { spaceId: 'camenduru/Wav2Lip', label: 'Wav2Lip Sync GPU' },
  ];

  let lastReason = 'Lip-Sync cloud queues busy';
  const lipSyncDeadline = Date.now() + 26000;

  for (let i = 0; i < spaces.length; i += 1) {
    if (isAborted?.()) return;
    if (Date.now() > lipSyncDeadline) {
      lastReason = 'Fast 26s cloud window reached';
      break;
    }
    const target = spaces[i];
    try {
      progressCb(18 + i * 5, `Connecting to ${target.label}...`);
      const client = await connectSpaceFast(target.spaceId, resolvedHfToken, 7000);
      const apiInfo = (await withTimeout(
        client.view_api(),
        4500,
        `Inspect ${target.spaceId} API`
      )) as {
        named_endpoints?: Record<string, { parameters?: GradioParamInfo[] }>;
      };

      const endpoints = Object.keys(apiInfo.named_endpoints ?? {});
      const preferred =
        endpoints.find((e) =>
          /predict|generate|test|inference|run|submit|talk|wav2lip/i.test(e)
        ) || endpoints[0];

      if (!preferred) {
        throw new Error(`${target.spaceId} has no active lip-sync endpoint`);
      }

      const payload = mapLipSyncPayload(
        apiInfo.named_endpoints?.[preferred]?.parameters,
        imageBlob,
        audioBlob
      );

      const res = await runGradioJob({
        spaceId: target.spaceId,
        label: target.label,
        endpoint: preferred,
        payload,
        hfToken: resolvedHfToken,
        existingClient: client,
        connectTimeoutMs: 7000,
        quickQueueTimeoutMs: resolvedHfToken ? 13000 : 8000,
        jobTimeoutMs: 22000,
        onProgress: progressCb,
      });

      if (isAborted?.()) return;

      const fileId = storeCachedHfVideo(res.buffer, res.mimeType);
      onEvent({
        type: 'done',
        percent: 100,
        message: 'Lip-synced talking video ready via HF Lip-Sync GPU!',
        providerLabel: 'Rendered via HF Lip-Sync GPU',
        videoApiPath: `/api/hf-video-file/${fileId}`,
        mimeType: res.mimeType,
        width: 512,
        height: 512,
      });
      return;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'Space unavailable';
    }
  }

  if (!isAborted?.()) {
    onEvent({
      type: 'busy',
      message: `Cloud Lip-Sync GPUs busy (${lastReason}) — switching to CineGen Smart Lip-Sync Animator...`,
    });
  }
}
