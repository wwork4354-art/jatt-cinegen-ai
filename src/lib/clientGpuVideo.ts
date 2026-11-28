import { Client, handle_file } from '@gradio/client';
import { InferenceClient } from '@huggingface/inference';
import type { AspectRatio } from '../types/studio';
import {
  buildVideoNegativePrompt,
  enhanceTextToVideoPromptFraming,
} from '../../shared/videoPromptFraming';

export interface ClientGpuVideoResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  engineLabel: string;
}

const clientVideoCache = new Map<
  string,
  { blob: Blob; mimeType: string; width: number; height: number; engineLabel: string; createdAt: number }
>();

function getClientCachedVideo(key: string): ClientGpuVideoResult | null {
  const entry = clientVideoCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
    clientVideoCache.delete(key);
    return null;
  }
  return {
    blob: entry.blob,
    mediaUrl: URL.createObjectURL(entry.blob),
    mimeType: entry.mimeType,
    width: entry.width,
    height: entry.height,
    engineLabel: entry.engineLabel,
  };
}

function storeClientCachedVideo(key: string, res: ClientGpuVideoResult): void {
  if (clientVideoCache.size >= 6) {
    const oldestKey = clientVideoCache.keys().next().value;
    if (oldestKey) clientVideoCache.delete(oldestKey);
  }
  clientVideoCache.set(key, {
    blob: res.blob,
    mimeType: res.mimeType,
    width: res.width,
    height: res.height,
    engineLabel: res.engineLabel,
    createdAt: Date.now(),
  });
}

function parseDataUrlParts(dataUrl: string): { mimeType: string; base64: string; blob: Blob } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || 'image/png';
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mimeType, base64, blob: new Blob([bytes], { type: mimeType }) };
}

async function resolveInputBlob(source: string | Blob): Promise<Blob> {
  if (source instanceof Blob) return source;
  const parsed = parseDataUrlParts(source);
  if (parsed) return parsed.blob;
  const res = await fetch(source);
  if (!res.ok) throw new Error('Could not read uploaded media file');
  return res.blob();
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
  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function buildConnectOptions(hfToken?: string): { hf_token?: `hf_${string}`; token?: `hf_${string}` } | undefined {
  const trimmed = hfToken?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed as `hf_${string}`;
  return { hf_token: normalized, token: normalized };
}

async function runBrowserGradioJob(params: {
  spaceId: string;
  label: string;
  endpoint: string;
  payload: Record<string, unknown> | unknown[];
  hfToken?: string;
  existingClient?: Client;
  initialMessage: string;
  quickQueueTimeoutMs?: number;
  jobTimeoutMs?: number;
  onProgress: (percent: number, message: string) => void;
}): Promise<Blob> {
  const {
    spaceId,
    label,
    endpoint,
    payload,
    hfToken,
    existingClient,
    initialMessage,
    quickQueueTimeoutMs = hfToken?.trim() ? 13000 : 8000,
    jobTimeoutMs = 24000,
    onProgress,
  } = params;

  onProgress(22, initialMessage);
  const opts = buildConnectOptions(hfToken);
  const client =
    existingClient ??
    (await withTimeout(
      opts ? Client.connect(spaceId, opts) : Client.connect(spaceId),
      7500,
      `Connect ${label}`
    ));

  onProgress(28, `Submitting fast clip to ${label} GPU...`);
  const submission = client.submit(endpoint, payload) as AsyncIterable<Record<string, unknown>> & {
    cancel?: () => Promise<void> | void;
  };

  const startedAt = Date.now();
  let hasStartedGenerating = false;
  let lastPercent = 30;
  let settled = false;

  const resultData = await new Promise<unknown>((resolve, reject) => {
    let watchdogTimer: number | undefined;

    const cleanup = () => {
      settled = true;
      if (watchdogTimer !== undefined) window.clearInterval(watchdogTimer);
    };

    const abortJob = (reason: string) => {
      if (settled) return;
      cleanup();
      try {
        void Promise.resolve(submission.cancel?.()).catch(() => {});
      } catch {
        // Ignore cancel error
      }
      reject(new Error(reason));
    };

    watchdogTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (!hasStartedGenerating && elapsed > quickQueueTimeoutMs) {
        abortJob(`${label} queue busy`);
        return;
      }
      if (elapsed > jobTimeoutMs) {
        abortJob(`${label} GPU timeout`);
        return;
      }
      lastPercent = Math.min(hasStartedGenerating ? 82 : 44, lastPercent + 2);
      onProgress(
        lastPercent,
        hasStartedGenerating
          ? `Generating fast 16fps clip via ${label}...`
          : `Checking ${label} GPU (${Math.round(elapsed / 1000)}s)...`
      );
    }, 1500);

    (async () => {
      try {
        for await (const rawMsg of submission) {
          if (settled) break;
          if (!rawMsg || typeof rawMsg !== 'object') continue;
          if (rawMsg.type === 'status') {
            const stage = String(rawMsg.stage || '');
            const msgText = typeof rawMsg.message === 'string' ? rawMsg.message : '';
            if (stage === 'error') {
              abortJob(msgText || `${label} returned an error`);
              return;
            }
            if (typeof rawMsg.eta === 'number' && rawMsg.eta > 35) {
              abortJob(`${label} queue wait too long (~${Math.round(rawMsg.eta)}s)`);
              return;
            }
            if (stage === 'generating') {
              hasStartedGenerating = true;
              lastPercent = Math.max(lastPercent, 58);
              onProgress(lastPercent, `Generating real AI motion via ${label}...`);
            } else if (typeof rawMsg.position === 'number' && rawMsg.position > 0) {
              lastPercent = Math.max(lastPercent, 36);
              onProgress(lastPercent, `${label} GPU Queue (#${rawMsg.position})...`);
            } else {
              lastPercent = Math.max(lastPercent, 38);
              onProgress(lastPercent, `Running AI model on ${label}...`);
            }
          } else if (rawMsg.type === 'data') {
            cleanup();
            resolve(rawMsg.data);
            return;
          }
        }
        if (!settled) {
          abortJob(`${label} finished without output`);
        }
      } catch (err) {
        abortJob(err instanceof Error ? err.message : `${label} stream error`);
      }
    })();
  });

  const videoUrl = extractGradioVideoUrl(resultData);
  if (!videoUrl) {
    throw new Error(`${label} did not return a video stream`);
  }

  onProgress(88, `Downloading generated MP4 from ${label}...`);
  const mediaRes = await withTimeout(fetch(videoUrl), 25000, `Download MP4 from ${label}`);
  if (!mediaRes.ok) {
    throw new Error(`Failed to fetch video output (HTTP ${mediaRes.status})`);
  }
  const blob = await mediaRes.blob();
  if (blob.size < 5000) {
    throw new Error(`${label} returned an empty video file`);
  }
  return blob;
}

// Direct Browser Google Veo REST Execution (for static deploys like Vercel with VITE_GEMINI_API_KEY)
async function tryDirectBrowserGoogleVeo(params: {
  geminiKey: string;
  prompt: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  imageDataUrl?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { geminiKey, prompt, mode, aspectRatio, imageDataUrl, onProgress } = params;
  onProgress(
    18,
    mode === 'image-to-video'
      ? 'Sending photo to Google Veo 2.0 AI GPU for real motion...'
      : 'Routing to Google Veo 2.0 Video Engine...'
  );

  const veoRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
  const parsedImg = mode === 'image-to-video' && imageDataUrl ? parseDataUrlParts(imageDataUrl) : null;

  const instance: Record<string, unknown> = { prompt };
  if (parsedImg) {
    instance.image = {
      bytesBase64Encoded: parsedImg.base64,
      mimeType: parsedImg.mimeType,
    };
  }

  const startRes = await withTimeout(
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${encodeURIComponent(
        geminiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            aspectRatio: veoRatio,
            personGeneration: 'allow_adult',
          },
        }),
      }
    ),
    15000,
    'Google Veo request'
  );

  if (!startRes.ok) {
    throw new Error(`Google Veo HTTP ${startRes.status}`);
  }

  const opStart = (await startRes.json()) as { name?: string };
  if (!opStart.name) {
    throw new Error('Google Veo returned no operation name');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 75000) {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(80, 28 + elapsedSec), 'Generating real AI motion via Google Veo 2.0...');
    await new Promise((r) => setTimeout(r, 1500));

    const pollRes = await withTimeout(
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/${opStart.name}?key=${encodeURIComponent(
          geminiKey
        )}`
      ),
      10000,
      'Google Veo poll'
    );
    if (!pollRes.ok) continue;

    const pollData = (await pollRes.json()) as {
      done?: boolean;
      response?: {
        generateVideoResponse?: {
          generatedSamples?: Array<{ video?: { uri?: string } }>;
        };
      };
    };

    if (pollData.done) {
      const uri = pollData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        throw new Error('Google Veo completed without a video URI');
      }
      const sep = uri.includes('?') ? '&' : '?';
      const videoRes = await withTimeout(
        fetch(`${uri}${sep}key=${encodeURIComponent(geminiKey)}`),
        30000,
        'Download Google Veo MP4'
      );
      if (!videoRes.ok) {
        throw new Error(`Failed to download Veo MP4 (${videoRes.status})`);
      }
      const blob = await videoRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width: veoRatio === '9:16' ? 720 : 1280,
        height: veoRatio === '9:16' ? 1280 : 720,
        engineLabel: 'Rendered via Google Veo',
      };
    }
  }

  throw new Error('Google Veo generation timed out');
}

async function tryDirectBrowserPollinationsVideo(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  imageDataUrl?: string;
  pollinationsKey?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { prompt, aspectRatio, imageDataUrl, pollinationsKey, onProgress } = params;
  const width = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 768 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 768 : 720;

  const keyParam = pollinationsKey?.trim()
    ? `&key=${encodeURIComponent(pollinationsKey.trim())}`
    : '';
  const imageParam =
    imageDataUrl && (imageDataUrl.startsWith('http://') || imageDataUrl.startsWith('https://'))
      ? `&image[0]=${encodeURIComponent(imageDataUrl)}`
      : '';

  const models = ['seedance-2.0', 'seedance-2.5-flash', 'wan-fast', 'wan', 'veo'];
  let lastError = 'Pollinations.ai Video API unavailable';

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    onProgress(16 + i * 5, `Generating real 5s MP4 via Pollinations.ai (${model})...`);
    const url = `https://gen.pollinations.ai/video/${encodeURIComponent(
      prompt
    )}?model=${encodeURIComponent(model)}&duration=5&aspectRatio=${encodeURIComponent(
      aspectRatio
    )}${imageParam}${keyParam}`;

    try {
      const headers: Record<string, string> = {};
      if (pollinationsKey?.trim()) {
        headers.Authorization = `Bearer ${pollinationsKey.trim()}`;
      }
      const res = await withTimeout(
        fetch(url, { headers }),
        32000,
        `Pollinations (${model})`
      );
      if (!res.ok) {
        let detail = '';
        try {
          const errJson = (await res.json()) as { error?: { message?: string } | string };
          detail = typeof errJson.error === 'string' ? errJson.error : errJson.error?.message || '';
        } catch {
          // Ignore JSON parse errors
        }
        lastError = detail || `Pollinations Video (${model}) HTTP ${res.status}`;
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          throw new Error(lastError);
        }
        continue;
      }
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (!ctype.startsWith('video/') && !ctype.includes('octet-stream')) {
        lastError = `Pollinations Video (${model}) returned ${ctype || 'non-video'}`;
        continue;
      }
      const blob = await res.blob();
      if (blob.size < 8000) {
        lastError = `Pollinations Video (${model}) returned empty clip`;
        continue;
      }
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: ctype.startsWith('video/') ? ctype.split(';')[0] : 'video/mp4',
        width,
        height,
        engineLabel: `Rendered via Pollinations.ai (${model})`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Pollinations (${model}) failed`;
      if (lastError.includes('HTTP 401') || lastError.includes('HTTP 402') || lastError.includes('HTTP 403')) {
        throw new Error(lastError);
      }
    }
  }

  throw new Error(lastError);
}

async function tryDirectBrowserSiliconFlowVideo(params: {
  siliconFlowKey: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  seed?: number;
  imageDataUrl?: string;
  isAborted?: () => boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { siliconFlowKey, prompt, negativePrompt, mode, aspectRatio, seed, imageDataUrl, isAborted, onProgress } =
    params;
  onProgress(20, 'Routing to Qwen Wan 2.1 (SiliconFlow API)...');

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
    if (isAborted?.()) throw new Error('Aborted');
    try {
      const res = await withTimeout(
        fetch(`${host}/v1/video/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${siliconFlowKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: isI2v ? 'Wan-AI/Wan2.1-I2V-14B-720P' : 'Wan-AI/Wan2.1-T2V-14B',
            prompt,
            ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
            ...(typeof seed === 'number' ? { seed } : {}),
            image_size: imageSize,
            ...(isI2v && imageDataUrl ? { image: imageDataUrl } : {}),
          }),
        }),
        10000,
        'SiliconFlow submit'
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { requestId?: string };
      if (data.requestId) {
        activeHost = host;
        requestId = data.requestId;
        break;
      }
    } catch {
      // Try next host
    }
  }

  if (!activeHost || !requestId) {
    throw new Error('SiliconFlow video API unavailable');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 50000) {
    if (isAborted?.()) throw new Error('Aborted');
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(82, 32 + elapsedSec), 'Generating Qwen Wan 2.1 motion video...');
    await new Promise((r) => setTimeout(r, 1500));
    if (isAborted?.()) throw new Error('Aborted');

    const statusRes = await withTimeout(
      fetch(`${activeHost}/v1/video/status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${siliconFlowKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      }),
      8000,
      'SiliconFlow status'
    );
    if (!statusRes.ok) throw new Error(`SiliconFlow HTTP ${statusRes.status}`);

    const statusData = (await statusRes.json()) as {
      status?: string;
      reason?: string;
      results?: { videos?: Array<{ url?: string }> };
    };
    if (statusData.status === 'Succeed') {
      const videoUrl = statusData.results?.videos?.[0]?.url;
      if (!videoUrl) throw new Error('SiliconFlow completed without a video URL');
      onProgress(88, 'Downloading generated MP4 from Qwen Wan 2.1...');
      const mediaRes = await withTimeout(fetch(videoUrl), 25000, 'Download Wan 2.1 MP4');
      if (!mediaRes.ok) throw new Error(`Failed to fetch Wan 2.1 MP4 (${mediaRes.status})`);
      const blob = await mediaRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via Qwen Wan 2.1 (SiliconFlow)',
      };
    }
    if (statusData.status === 'Failed') {
      throw new Error(statusData.reason || 'SiliconFlow video job failed');
    }
  }

  throw new Error('SiliconFlow Wan 2.1 timed out');
}

async function tryDirectBrowserHuggingFaceInferenceVideo(params: {
  hfToken: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  imageBlob?: Blob | null;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { hfToken, prompt, negativePrompt, mode, aspectRatio, imageBlob, onProgress } = params;
  const width = aspectRatio === '9:16' ? 480 : aspectRatio === '1:1' ? 512 : 768;
  const height = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 512 : 448;
  const client = new InferenceClient(hfToken);

  if (mode === 'image-to-video' && imageBlob) {
    onProgress(26, 'Animating reference photo via HF Inference API (Wan2.1-I2V)...');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 32000);
    try {
      const blob = await withTimeout(
        client.imageToVideo(
          {
            model: 'Wan-AI/Wan2.1-I2V-14B-720P',
            provider: 'auto',
            inputs: imageBlob,
            parameters: {
              prompt,
              ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
              num_inference_steps: 20,
              guidance_scale: 5.0,
            },
          },
          { signal: controller.signal }
        ),
        32000,
        'Wan2.1-I2V'
      );
      if (blob.size < 8000) throw new Error('HF I2V returned empty video');
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via HF Inference (Wan2.1-I2V)',
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  const models = [
    { id: 'Wan-AI/Wan2.1-T2V-1.3B', badge: 'Rendered via HF Inference (Wan2.1-1.3B)' },
    { id: 'Wan-AI/Wan2.1-T2V-14B', badge: 'Rendered via HF Inference (Wan2.1-14B)' },
    { id: 'zai-org/CogVideoX-5b', badge: 'Rendered via HF Inference (CogVideoX-5b)' },
    { id: 'Lightricks/LTX-Video-0.9.5', badge: 'Rendered via HF Inference (LTX-Video)' },
  ];

  let lastErr = 'HF Inference video models unavailable';
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    onProgress(24 + i * 7, `Generating real motion video via HF Inference (${model.id})...`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 28000);
    try {
      const blob = await withTimeout(
        client.textToVideo(
          {
            model: model.id,
            provider: 'auto',
            inputs: prompt,
            parameters: {
              num_frames: 41,
              num_inference_steps: 20,
              guidance_scale: model.id.includes('LTX') ? 3.0 : 5.0,
              ...(negativePrompt ? { negative_prompt: [negativePrompt] } : {}),
            },
          },
          { signal: controller.signal }
        ),
        28000,
        model.id
      );
      if (blob.size < 8000) {
        lastErr = `${model.id} returned empty video`;
        continue;
      }
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: model.badge,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : `${model.id} failed`;
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error(lastErr);
}

async function tryDirectBrowserAgnesAiVideo(params: {
  agnesKey: string;
  prompt: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  duration?: '5s' | '10s' | '15s';
  imageDataUrl?: string;
  isAborted?: () => boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { agnesKey, prompt, mode, aspectRatio, duration, imageDataUrl, isAborted, onProgress } = params;
  onProgress(24, 'Routing to Agnes AI (Agnes-Video-2.5)...');

  const width = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 768 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 768 : 720;
  const durationSeconds = duration === '10s' || duration === '15s' ? 10 : 5;

  const submitBody: Record<string, unknown> = {
    model: 'agnes-video-2.5',
    prompt,
    aspect_ratio: aspectRatio,
    duration: durationSeconds,
  };
  if (mode === 'image-to-video' && imageDataUrl) {
    submitBody.image_url = imageDataUrl;
  }

  const submitRes = await withTimeout(
    fetch('https://apihub.agnes-ai.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agnesKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submitBody),
    }),
    12000,
    'Agnes AI submit'
  );

  if (!submitRes.ok) {
    throw new Error(`Agnes AI HTTP ${submitRes.status}`);
  }

  const created = (await submitRes.json()) as {
    video_id?: string;
    id?: string;
    task_id?: string;
    url?: string;
    video_url?: string;
    data?: { video_id?: string; id?: string; url?: string; video_url?: string };
  };

  const immediateUrl =
    created.url || created.video_url || created.data?.url || created.data?.video_url;
  if (immediateUrl && immediateUrl.startsWith('http')) {
    onProgress(88, 'Downloading generated MP4 from Agnes AI...');
    const mediaRes = await withTimeout(fetch(immediateUrl), 25000, 'Download Agnes AI MP4');
    if (!mediaRes.ok) throw new Error(`Failed to fetch Agnes AI MP4 (${mediaRes.status})`);
    const blob = await mediaRes.blob();
    return {
      blob,
      mediaUrl: URL.createObjectURL(blob),
      mimeType: blob.type || 'video/mp4',
      width,
      height,
      engineLabel: 'Rendered via Agnes AI (Agnes-Video-2.5)',
    };
  }

  const videoId =
    created.video_id || created.id || created.task_id || created.data?.video_id || created.data?.id;
  if (!videoId) {
    throw new Error('Agnes AI returned no video_id');
  }

  const pollUrls = [
    `https://apihub.agnes-ai.com/v1/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=agnes-video-2.5`,
    `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=agnes-video-2.5`,
  ];

  const startedAt = Date.now();
  while (Date.now() - startedAt < 42000) {
    if (isAborted?.()) throw new Error('Aborted');
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(82, 34 + elapsedSec), 'Generating motion frames via Agnes-Video-2.5...');
    await new Promise((r) => setTimeout(r, 1500));
    if (isAborted?.()) throw new Error('Aborted');

    let resultJson: Record<string, unknown> | null = null;
    for (const pollUrl of pollUrls) {
      try {
        const pollRes = await withTimeout(
          fetch(pollUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${agnesKey}` },
          }),
          8000,
          'Agnes AI status'
        );
        if (pollRes.status === 404) continue;
        if (!pollRes.ok) throw new Error(`Agnes AI HTTP ${pollRes.status}`);
        resultJson = (await pollRes.json()) as Record<string, unknown>;
        break;
      } catch (err) {
        if (pollUrl === pollUrls[pollUrls.length - 1]) {
          throw err;
        }
      }
    }

    if (!resultJson) continue;

    const dataObj =
      resultJson.data && typeof resultJson.data === 'object'
        ? (resultJson.data as Record<string, unknown>)
        : undefined;
    const outputObj =
      resultJson.output && typeof resultJson.output === 'object'
        ? (resultJson.output as Record<string, unknown>)
        : undefined;
    const videosArr = Array.isArray(resultJson.videos)
      ? (resultJson.videos as Array<Record<string, unknown>>)
      : undefined;

    const status = String(resultJson.status || dataObj?.status || '').toLowerCase();
    const videoUrl =
      (typeof resultJson.url === 'string' && resultJson.url) ||
      (typeof resultJson.video_url === 'string' && resultJson.video_url) ||
      (typeof dataObj?.url === 'string' && dataObj.url) ||
      (typeof dataObj?.video_url === 'string' && dataObj.video_url) ||
      (typeof outputObj?.url === 'string' && outputObj.url) ||
      (typeof videosArr?.[0]?.url === 'string' && videosArr[0].url) ||
      '';

    if (videoUrl && videoUrl.startsWith('http')) {
      onProgress(88, 'Downloading generated MP4 from Agnes AI (Agnes-Video-2.5)...');
      const mediaRes = await withTimeout(fetch(videoUrl), 25000, 'Download Agnes AI MP4');
      if (!mediaRes.ok) throw new Error(`Failed to fetch Agnes AI MP4 (${mediaRes.status})`);
      const blob = await mediaRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via Agnes AI (Agnes-Video-2.5)',
      };
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      throw new Error(
        typeof resultJson.message === 'string' ? resultJson.message : 'Agnes AI job failed'
      );
    }
  }

  throw new Error('Agnes AI (Agnes-Video-2.5) timed out');
}

async function tryDirectBrowserFalAiVideo(params: {
  falKey: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  seed?: number;
  imageDataUrl?: string;
  isAborted?: () => boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { falKey, prompt, negativePrompt, mode, aspectRatio, seed, imageDataUrl, isAborted, onProgress } = params;
  const isI2v = mode === 'image-to-video' && Boolean(imageDataUrl);
  const width = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 768 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 768 : 720;

  const models = isI2v
    ? [
        { id: 'fal-ai/wan/v2.1/1.3b/image-to-video', label: 'Fal.ai Wan 2.1 I2V' },
        { id: 'fal-ai/minimax/video-01/image-to-video', label: 'Fal.ai Minimax I2V' },
      ]
    : [
        { id: 'fal-ai/wan/v2.1/1.3b/text-to-video', label: 'Fal.ai Wan 2.1' },
        { id: 'fal-ai/minimax-video', label: 'Fal.ai Minimax' },
      ];

  let lastErr = 'Fal.ai video models unavailable';
  for (const model of models) {
    if (isAborted?.()) throw new Error('Aborted');
    onProgress(28, `Routing to ${model.label}...`);
    const body: Record<string, unknown> = {
      prompt,
      ...(negativePrompt && model.id.includes('wan') ? { negative_prompt: negativePrompt } : {}),
      ...(model.id.includes('wan') ? { aspect_ratio: aspectRatio } : {}),
      ...(typeof seed === 'number' && model.id.includes('wan') ? { seed } : {}),
      ...(isI2v && imageDataUrl ? { image_url: imageDataUrl } : {}),
    };

    const submitRes = await withTimeout(
      fetch(`https://queue.fal.run/${model.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      12000,
      `${model.label} submit`
    );

    if (!submitRes.ok) {
      lastErr = `${model.label} HTTP ${submitRes.status}`;
      if (submitRes.status === 401 || submitRes.status === 402 || submitRes.status === 403) {
        throw new Error(lastErr);
      }
      continue;
    }

    const queued = (await submitRes.json()) as {
      request_id?: string;
      status_url?: string;
      response_url?: string;
      video?: { url?: string };
    };

    if (queued.video?.url) {
      const mediaRes = await withTimeout(fetch(queued.video.url), 25000, `Download ${model.label}`);
      if (!mediaRes.ok) throw new Error(`Failed to fetch ${model.label} MP4`);
      const blob = await mediaRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: `Rendered via ${model.label}`,
      };
    }

    const statusUrl =
      queued.status_url ||
      (queued.request_id
        ? `https://queue.fal.run/${model.id}/requests/${encodeURIComponent(queued.request_id)}/status`
        : '');
    const responseUrl =
      queued.response_url ||
      (queued.request_id
        ? `https://queue.fal.run/${model.id}/requests/${encodeURIComponent(queued.request_id)}`
        : '');
    if (!statusUrl || !responseUrl) continue;

    const startedAt = Date.now();
    while (Date.now() - startedAt < 42000) {
      if (isAborted?.()) throw new Error('Aborted');
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      onProgress(Math.min(82, 36 + elapsedSec), `Generating motion frames via ${model.label}...`);
      await new Promise((r) => setTimeout(r, 1500));
      if (isAborted?.()) throw new Error('Aborted');

      const statusRes = await withTimeout(
        fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } }),
        8000,
        `${model.label} status`
      );
      if (!statusRes.ok) break;
      const statusData = (await statusRes.json()) as { status?: string; error?: string };
      if (statusData.status === 'COMPLETED') {
        const resRes = await withTimeout(
          fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } }),
          10000,
          `${model.label} result`
        );
        if (!resRes.ok) throw new Error(`${model.label} result HTTP ${resRes.status}`);
        const resJson = (await resRes.json()) as {
          video?: { url?: string };
          output?: { video?: { url?: string } };
        };
        const videoUrl = resJson.video?.url || resJson.output?.video?.url || '';
        if (!videoUrl) throw new Error(`${model.label} returned no video URL`);
        onProgress(88, `Downloading MP4 from ${model.label}...`);
        const mediaRes = await withTimeout(fetch(videoUrl), 25000, `Download ${model.label}`);
        if (!mediaRes.ok) throw new Error(`Failed to fetch ${model.label} MP4`);
        const blob = await mediaRes.blob();
        return {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width,
          height,
          engineLabel: `Rendered via ${model.label}`,
        };
      }
      if (statusData.status === 'FAILED' || statusData.error) {
        throw new Error(statusData.error || `${model.label} failed`);
      }
    }
    lastErr = `${model.label} timed out`;
  }

  throw new Error(lastErr);
}

async function tryDirectBrowserReplicateVideo(params: {
  replicateToken: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  seed?: number;
  imageDataUrl?: string;
  isAborted?: () => boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { replicateToken, prompt, negativePrompt, mode, aspectRatio, seed, imageDataUrl, isAborted, onProgress } = params;
  const isI2v = mode === 'image-to-video' && Boolean(imageDataUrl);
  const width = aspectRatio === '9:16' ? 480 : aspectRatio === '1:1' ? 640 : 832;
  const height = aspectRatio === '9:16' ? 832 : aspectRatio === '1:1' ? 640 : 480;

  const models = isI2v
    ? [{ id: 'wan-video/wan-2.1-i2v-480p', label: 'Replicate Wan 2.1 I2V' }]
    : [
        { id: 'wan-video/wan-2.1-t2v-480p', label: 'Replicate Wan 2.1' },
        { id: 'wan-video/wan-2.1-1.3b', label: 'Replicate Wan 2.1 1.3B' },
      ];

  let lastErr = 'Replicate video models unavailable';
  for (const model of models) {
    if (isAborted?.()) throw new Error('Aborted');
    onProgress(30, `Routing to ${model.label}...`);
    const createRes = await withTimeout(
      fetch(`https://api.replicate.com/v1/models/${model.id}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          'Content-Type': 'application/json',
          Prefer: 'wait=10',
        },
        body: JSON.stringify({
          input: {
            prompt,
            ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
            ...(typeof seed === 'number' ? { seed } : {}),
            aspect_ratio: aspectRatio,
            sample_steps: 25,
            ...(isI2v && imageDataUrl ? { image: imageDataUrl } : {}),
          },
        }),
      }),
      14000,
      `${model.label} submit`
    );

    if (!createRes.ok) {
      lastErr = `${model.label} HTTP ${createRes.status}`;
      if (
        createRes.status === 401 ||
        createRes.status === 402 ||
        createRes.status === 403 ||
        createRes.status === 429
      ) {
        throw new Error(lastErr);
      }
      continue;
    }

    let pred = (await createRes.json()) as {
      id?: string;
      status?: string;
      output?: string | string[];
      error?: string;
      urls?: { get?: string };
    };

    const startedAt = Date.now();
    while ((pred.status === 'starting' || pred.status === 'processing') && Date.now() - startedAt < 42000) {
      if (isAborted?.()) throw new Error('Aborted');
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      onProgress(Math.min(82, 36 + elapsedSec), `Generating Wan 2.1 frames via ${model.label}...`);
      await new Promise((r) => setTimeout(r, 1500));
      if (isAborted?.()) throw new Error('Aborted');
      const pollUrl = pred.urls?.get || (pred.id ? `https://api.replicate.com/v1/predictions/${pred.id}` : '');
      if (!pollUrl) break;
      const pollRes = await withTimeout(
        fetch(pollUrl, { headers: { Authorization: `Bearer ${replicateToken}` } }),
        8000,
        `${model.label} poll`
      );
      if (!pollRes.ok) throw new Error(`${model.label} poll HTTP ${pollRes.status}`);
      pred = (await pollRes.json()) as typeof pred;
    }

    if (pred.status === 'succeeded') {
      const outUrl =
        typeof pred.output === 'string'
          ? pred.output
          : Array.isArray(pred.output)
          ? pred.output.find((item) => typeof item === 'string')
          : undefined;
      if (!outUrl) throw new Error(`${model.label} returned no video URL`);
      onProgress(88, `Downloading MP4 from ${model.label}...`);
      const mediaRes = await withTimeout(fetch(outUrl), 25000, `Download ${model.label}`);
      if (!mediaRes.ok) throw new Error(`Failed to fetch ${model.label} MP4`);
      const blob = await mediaRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: `Rendered via ${model.label}`,
      };
    }

    lastErr = pred.error || `${model.label} failed`;
  }

  throw new Error(lastErr);
}

async function tryDirectBrowserDigenVideo(params: {
  digenKey: string;
  prompt: string;
  negativePrompt?: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  duration?: '5s' | '10s' | '15s';
  seed?: number;
  imageDataUrl?: string;
  isAborted?: () => boolean;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult> {
  const { digenKey, prompt, negativePrompt, mode, aspectRatio, duration, seed, imageDataUrl, isAborted, onProgress } = params;
  const trimmedKey = digenKey.trim();
  if (!trimmedKey) {
    throw new Error('Digen AI API key missing');
  }

  const isI2v = mode === 'image-to-video' && Boolean(imageDataUrl);
  const width = aspectRatio === '9:16' ? 720 : aspectRatio === '1:1' ? 768 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : aspectRatio === '1:1' ? 768 : 720;
  const durationSeconds = duration === '10s' || duration === '15s' ? 10 : 5;

  onProgress(24, isI2v ? 'Routing photo to Digen AI Image-to-Video Engine...' : 'Routing to Digen AI Video Engine...');

  const submitEndpoints = [
    'https://api.digen.ai/v2/video/generate',
    'https://api.digen.ai/v1/video/generate',
    'https://api.digen.ai/v1/videos/generations',
  ];

  const payload: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
    duration: durationSeconds,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(isI2v && imageDataUrl ? { image_url: imageDataUrl, image: imageDataUrl } : {}),
  };

  let created: Record<string, unknown> | null = null;
  let lastErr = 'Digen AI video endpoint unavailable';

  for (const endpoint of submitEndpoints) {
    if (isAborted?.()) throw new Error('Aborted');
    try {
      const submitRes = await withTimeout(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        12000,
        'Digen AI submit'
      );

      if (!submitRes.ok) {
        if (submitRes.status === 401 || submitRes.status === 402 || submitRes.status === 403 || submitRes.status === 429) {
          throw new Error(`Digen AI HTTP ${submitRes.status}`);
        }
        lastErr = `Digen AI HTTP ${submitRes.status}`;
        continue;
      }

      created = (await submitRes.json()) as Record<string, unknown>;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : lastErr;
      if (lastErr.includes('HTTP 401') || lastErr.includes('HTTP 402') || lastErr.includes('HTTP 403') || lastErr.includes('HTTP 429')) {
        throw err;
      }
    }
  }

  if (!created) throw new Error(lastErr);

  const createdData =
    created.data && typeof created.data === 'object' ? (created.data as Record<string, unknown>) : undefined;
  const immediateUrl =
    (typeof created.video_url === 'string' && created.video_url) ||
    (typeof created.url === 'string' && created.url) ||
    (typeof createdData?.video_url === 'string' && createdData.video_url) ||
    (typeof createdData?.url === 'string' && createdData.url) ||
    '';

  if (immediateUrl && immediateUrl.startsWith('https://')) {
    onProgress(88, 'Downloading MP4 from Digen AI...');
    const mediaRes = await withTimeout(fetch(immediateUrl), 25000, 'Download Digen AI MP4');
    if (!mediaRes.ok) throw new Error(`Failed to fetch Digen AI MP4 (${mediaRes.status})`);
    const blob = await mediaRes.blob();
    return {
      blob,
      mediaUrl: URL.createObjectURL(blob),
      mimeType: blob.type || 'video/mp4',
      width,
      height,
      engineLabel: 'Rendered via Digen AI',
    };
  }

  const taskId = String(
    created.task_id ||
      created.job_id ||
      created.video_id ||
      created.id ||
      createdData?.task_id ||
      createdData?.job_id ||
      createdData?.id ||
      ''
  ).trim();

  if (!taskId) throw new Error('Digen AI returned no video URL or task ID');

  const pollUrls = [
    `https://api.digen.ai/v2/video/status/${encodeURIComponent(taskId)}`,
    `https://api.digen.ai/v1/video/status?task_id=${encodeURIComponent(taskId)}`,
    `https://api.digen.ai/v1/tasks/${encodeURIComponent(taskId)}`,
  ];

  const startedAt = Date.now();
  while (Date.now() - startedAt < 42000) {
    if (isAborted?.()) throw new Error('Aborted');
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress(Math.min(82, 34 + elapsedSec), 'Generating cinema motion frames via Digen AI...');
    await new Promise((r) => setTimeout(r, 1500));
    if (isAborted?.()) throw new Error('Aborted');

    let resultJson: Record<string, unknown> | null = null;
    for (const pollUrl of pollUrls) {
      try {
        const pollRes = await withTimeout(
          fetch(pollUrl, { headers: { Authorization: `Bearer ${trimmedKey}` } }),
          8000,
          'Digen AI status'
        );
        if (pollRes.status === 404) continue;
        if (!pollRes.ok) throw new Error(`Digen AI HTTP ${pollRes.status}`);
        resultJson = (await pollRes.json()) as Record<string, unknown>;
        break;
      } catch (err) {
        if (pollUrl === pollUrls[pollUrls.length - 1]) throw err;
      }
    }

    if (!resultJson) continue;
    const dataObj =
      resultJson.data && typeof resultJson.data === 'object' ? (resultJson.data as Record<string, unknown>) : undefined;
    const statusText = String(resultJson.status || dataObj?.status || '').toLowerCase();
    const videoUrl =
      (typeof resultJson.video_url === 'string' && resultJson.video_url) ||
      (typeof resultJson.url === 'string' && resultJson.url) ||
      (typeof dataObj?.video_url === 'string' && dataObj.video_url) ||
      (typeof dataObj?.url === 'string' && dataObj.url) ||
      '';

    if (videoUrl && videoUrl.startsWith('https://')) {
      onProgress(88, 'Downloading MP4 from Digen AI...');
      const mediaRes = await withTimeout(fetch(videoUrl), 25000, 'Download Digen AI MP4');
      if (!mediaRes.ok) throw new Error(`Failed to fetch Digen AI MP4 (${mediaRes.status})`);
      const blob = await mediaRes.blob();
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via Digen AI',
      };
    }

    if (statusText === 'failed' || statusText === 'error' || statusText === 'canceled' || statusText === 'cancelled') {
      throw new Error(typeof resultJson.message === 'string' ? resultJson.message : 'Digen AI job failed');
    }
  }

  throw new Error('Digen AI timed out');
}

export async function runDirectBrowserAiVideo(params: {
  prompt: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  duration?: '5s' | '10s' | '15s';
  seed?: number;
  imageDataUrl?: string;
  geminiKey?: string;
  hfToken?: string;
  siliconFlowKey?: string;
  pollinationsKey?: string;
  agnesKey?: string;
  falKey?: string;
  replicateToken?: string;
  digenKey?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult | null> {
  const {
    prompt,
    mode,
    aspectRatio,
    duration,
    seed,
    imageDataUrl,
    geminiKey,
    hfToken,
    siliconFlowKey,
    pollinationsKey,
    agnesKey,
    falKey,
    replicateToken,
    digenKey,
    onProgress,
  } = params;
  // 0ms key validation — skip empty keys immediately
  const resolvedGemini = geminiKey?.trim() || '';
  const resolvedHf = hfToken?.trim() || '';
  const resolvedSf = siliconFlowKey?.trim() || '';
  const resolvedPollinations = pollinationsKey?.trim() || '';
  const resolvedAgnes = agnesKey?.trim() || '';
  const resolvedFal = falKey?.trim() || '';
  const resolvedReplicate = replicateToken?.trim() || '';
  const resolvedDigen = digenKey?.trim() || '';

  const effectivePrompt =
    mode === 'text-to-video' ? enhanceTextToVideoPromptFraming(prompt) : prompt;
  const negativePrompt = buildVideoNegativePrompt(effectivePrompt);

  const cacheKey = `${mode}|${aspectRatio}|${seed ?? 'rand'}|${effectivePrompt.toLowerCase().trim()}|${
    imageDataUrl ? `${imageDataUrl.slice(0, 64)}:${imageDataUrl.length}` : ''
  }`;
  const cachedHit = getClientCachedVideo(cacheKey);
  if (cachedHit) {
    onProgress(100, `${cachedHit.engineLabel} (Instant Cache)`);
    return cachedHit;
  }

  const imageBlob =
    mode === 'image-to-video' && imageDataUrl ? await resolveInputBlob(imageDataUrl) : null;

  let raceWon = false;
  const raceAborted = () => raceWon;
  const raceProgress = (pct: number, msg: string) => {
    if (!raceWon) onProgress(pct, msg);
  };

  const parallelRacers: Array<{ name: string; run: () => Promise<ClientGpuVideoResult> }> = [];

  if (resolvedSf) {
    parallelRacers.push({
      name: 'SiliconFlow',
      run: () =>
        tryDirectBrowserSiliconFlowVideo({
          siliconFlowKey: resolvedSf,
          prompt: effectivePrompt,
          negativePrompt,
          mode,
          aspectRatio,
          seed,
          imageDataUrl,
          isAborted: raceAborted,
          onProgress: raceProgress,
        }),
    });
  }

  if (resolvedDigen) {
    parallelRacers.push({
      name: 'Digen AI',
      run: () =>
        tryDirectBrowserDigenVideo({
          digenKey: resolvedDigen,
          prompt: effectivePrompt,
          negativePrompt,
          mode,
          aspectRatio,
          duration,
          seed,
          imageDataUrl,
          isAborted: raceAborted,
          onProgress: raceProgress,
        }),
    });
  }

  if (resolvedAgnes) {
    parallelRacers.push({
      name: 'Agnes AI',
      run: () =>
        tryDirectBrowserAgnesAiVideo({
          agnesKey: resolvedAgnes,
          prompt: effectivePrompt,
          mode,
          aspectRatio,
          duration,
          imageDataUrl,
          isAborted: raceAborted,
          onProgress: raceProgress,
        }),
    });
  }

  if (resolvedFal) {
    parallelRacers.push({
      name: 'Fal.ai',
      run: () =>
        tryDirectBrowserFalAiVideo({
          falKey: resolvedFal,
          prompt: effectivePrompt,
          negativePrompt,
          mode,
          aspectRatio,
          seed,
          imageDataUrl,
          isAborted: raceAborted,
          onProgress: raceProgress,
        }),
    });
  }

  if (resolvedReplicate) {
    parallelRacers.push({
      name: 'Replicate',
      run: () =>
        tryDirectBrowserReplicateVideo({
          replicateToken: resolvedReplicate,
          prompt: effectivePrompt,
          negativePrompt,
          mode,
          aspectRatio,
          seed,
          imageDataUrl,
          isAborted: raceAborted,
          onProgress: raceProgress,
        }),
    });
  }

  if (resolvedHf) {
    parallelRacers.push({
      name: 'HF Inference',
      run: () =>
        tryDirectBrowserHuggingFaceInferenceVideo({
          hfToken: resolvedHf,
          prompt: effectivePrompt,
          negativePrompt,
          mode,
          aspectRatio,
          imageBlob,
          onProgress: raceProgress,
        }),
    });
  }

  if (parallelRacers.length > 0) {
    onProgress(16, `0ms key check complete — racing ${parallelRacers.map((r) => r.name).join(', ')}...`);
    try {
      const winner = await withTimeout(
        Promise.any(parallelRacers.map((r) => r.run())),
        44000,
        'Browser parallel video race'
      );
      raceWon = true;
      storeClientCachedVideo(cacheKey, winner);
      return winner;
    } catch {
      raceWon = true;
      onProgress(34, 'Active REST engines busy — switching to Google Veo / free HF GPUs...');
    }
  }

  // Fallback 1: Google Veo 2.0
  if (resolvedGemini) {
    try {
      const veoRes = await tryDirectBrowserGoogleVeo({
        geminiKey: resolvedGemini,
        prompt: effectivePrompt,
        mode,
        aspectRatio,
        imageDataUrl,
        onProgress,
      });
      storeClientCachedVideo(cacheKey, veoRes);
      return veoRes;
    } catch {
      // Proceed to Hugging Face Gradio GPUs
    }
  }

  const width = aspectRatio === '9:16' ? 384 : aspectRatio === '1:1' ? 512 : 640;
  const height = aspectRatio === '9:16' ? 640 : aspectRatio === '1:1' ? 512 : 384;
  const routerDeadline = Date.now() + 26000;
  const fixedSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 1000000);
  const randomizeSeed = typeof seed !== 'number';

  if (mode === 'image-to-video' && imageBlob) {
    // Attempt A: Lightricks/ltx-video-distilled (/image_to_video)
    if (Date.now() <= routerDeadline) {
      try {
        const blob = await runBrowserGradioJob({
          spaceId: 'Lightricks/ltx-video-distilled',
          label: 'LTX-Video Distilled',
          endpoint: '/image_to_video',
          initialMessage: 'Sending photo to AI GPU for fast 16fps motion...',
          payload: {
            prompt: effectivePrompt,
            negative_prompt: negativePrompt,
            input_image_filepath: handle_file(imageBlob),
            input_video_filepath: null,
            height_ui: height,
            width_ui: width,
            mode: 'image-to-video',
            duration_ui: 2,
            ui_frames_to_use: 9,
            seed_ui: fixedSeed,
            randomize_seed: randomizeSeed,
            ui_guidance_scale: 1,
            improve_texture_flag: false,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 11000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        const res = {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width,
          height,
          engineLabel: 'Rendered via LTX-Video GPU',
        };
        storeClientCachedVideo(cacheKey, res);
        return res;
      } catch {
        // Try next HF GPU
      }
    }

    // Attempt B: multimodalart/wan2-1-fast (/generate_video)
    if (Date.now() <= routerDeadline) {
      try {
        const wanW = aspectRatio === '9:16' ? 480 : aspectRatio === '1:1' ? 512 : 768;
        const wanH = aspectRatio === '9:16' ? 768 : 480;
        const blob = await runBrowserGradioJob({
          spaceId: 'multimodalart/wan2-1-fast',
          label: 'Qwen Wan 2.1',
          endpoint: '/generate_video',
          initialMessage: 'Routing to Qwen Wan 2.1 AI GPU (16fps fast)...',
          payload: {
            input_image: handle_file(imageBlob),
            prompt: effectivePrompt,
            height: wanH,
            width: wanW,
            negative_prompt: negativePrompt,
            duration_seconds: 2,
            guidance_scale: 1,
            steps: 4,
            seed: fixedSeed,
            randomize_seed: randomizeSeed,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 11000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        const res = {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width: wanW,
          height: wanH,
          engineLabel: 'Rendered via Qwen Wan 2.1',
        };
        storeClientCachedVideo(cacheKey, res);
        return res;
      } catch {
        // Try next HF GPU
      }
    }

    // Attempt C: stabilityai/stable-video-diffusion (/video)
    if (Date.now() <= routerDeadline) {
      try {
        const blob = await runBrowserGradioJob({
          spaceId: 'stabilityai/stable-video-diffusion',
          label: 'Stable Video Diffusion',
          endpoint: '/video',
          initialMessage: 'Routing to Stable Video Diffusion (16fps)...',
          payload: {
            image: handle_file(imageBlob),
            seed: fixedSeed,
            randomize_seed: randomizeSeed,
            motion_bucket_id: 127,
            fps_id: 16,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 10000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        const res = {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width: 1024,
          height: 576,
          engineLabel: 'Rendered via Stable Video Diffusion GPU',
        };
        storeClientCachedVideo(cacheKey, res);
        return res;
      } catch {
        // Fall through cleanly
      }
    }

    return null;
  }

  // Text-to-Video direct browser HF spaces (LTX-Video -> CogVideoX-2B)
  if (Date.now() <= routerDeadline) {
    try {
      const blob = await runBrowserGradioJob({
        spaceId: 'Lightricks/ltx-video-distilled',
        label: 'LTX-Video Distilled',
        endpoint: '/text_to_video',
        initialMessage: 'Connecting to LTX-Video AI GPU (16fps fast)...',
        payload: {
          prompt: effectivePrompt,
          negative_prompt: negativePrompt,
          input_image_filepath: null,
          input_video_filepath: null,
          height_ui: height,
          width_ui: width,
          mode: 'text-to-video',
          duration_ui: 2,
          ui_frames_to_use: 9,
          seed_ui: fixedSeed,
          randomize_seed: randomizeSeed,
          ui_guidance_scale: 1,
          improve_texture_flag: false,
        },
        hfToken: resolvedHf,
        quickQueueTimeoutMs: 11000,
        jobTimeoutMs: 22000,
        onProgress,
      });
      const res = {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via LTX-Video GPU',
      };
      storeClientCachedVideo(cacheKey, res);
      return res;
    } catch {
      // Try CogVideoX next
    }
  }

  if (Date.now() <= routerDeadline) {
    try {
      const blob = await runBrowserGradioJob({
        spaceId: 'zai-org/CogVideoX-2b-space',
        label: 'CogVideoX-2B',
        endpoint: '/generate',
        initialMessage: 'Connecting to CogVideoX-2B AI GPU (fast steps)...',
        payload: {
          prompt: effectivePrompt,
          num_inference_steps: 16,
          guidance_scale: 6,
        },
        hfToken: resolvedHf,
        quickQueueTimeoutMs: 10000,
        jobTimeoutMs: 22000,
        onProgress,
      });
      const res = {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width: 720,
        height: 480,
        engineLabel: 'Rendered via CogVideoX GPU',
      };
      storeClientCachedVideo(cacheKey, res);
      return res;
    } catch {
      // Try Pollinations Video if key is configured
    }
  }

  if (resolvedPollinations) {
    try {
      const res = await tryDirectBrowserPollinationsVideo({
        prompt: effectivePrompt,
        aspectRatio,
        imageDataUrl: mode === 'image-to-video' ? imageDataUrl : undefined,
        pollinationsKey: resolvedPollinations,
        onProgress,
      });
      storeClientCachedVideo(cacheKey, res);
      return res;
    } catch {
      return null;
    }
  }

  return null;
}

interface GradioParamMeta {
  parameter_name?: string;
  label?: string;
  component?: string;
  parameter_default?: unknown;
}

export async function runDirectBrowserLipSync(params: {
  imageDataUrl: string;
  audioBlob: Blob;
  audioDataUrl?: string;
  hfToken?: string;
  replicateToken?: string;
  digenKey?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult | null> {
  const { imageDataUrl, audioBlob, audioDataUrl, hfToken, replicateToken, digenKey, onProgress } = params;
  const resolvedHf = hfToken?.trim() || '';
  const resolvedReplicate = replicateToken?.trim() || '';
  const resolvedDigen = digenKey?.trim() || '';
  const imageBlob = await resolveInputBlob(imageDataUrl);
  const opts = buildConnectOptions(resolvedHf);

  if (resolvedDigen && audioDataUrl) {
    const avatarEndpoints = [
      'https://api.digen.ai/v2/avatar/generate',
      'https://api.digen.ai/v1/avatar/generate',
      'https://api.digen.ai/v1/lip-sync/generate',
    ];
    for (const endpoint of avatarEndpoints) {
      try {
        onProgress(24, 'Routing portrait & audio to Digen AI Talking Avatar...');
        const submitRes = await withTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resolvedDigen}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              image_url: imageDataUrl,
              audio_url: audioDataUrl,
              source_image: imageDataUrl,
              driven_audio: audioDataUrl,
            }),
          }),
          12000,
          'Digen AI Avatar submit'
        );
        if (!submitRes.ok) {
          if (submitRes.status === 401 || submitRes.status === 402 || submitRes.status === 403 || submitRes.status === 429) {
            onProgress(28, 'Digen AI key unauthorized or credits exhausted — switching to next lip-sync engine...');
            break;
          }
          continue;
        }
        const created = (await submitRes.json()) as {
          video_url?: string;
          url?: string;
          task_id?: string;
          job_id?: string;
          id?: string;
          data?: { video_url?: string; url?: string; task_id?: string; job_id?: string; id?: string };
        };
        let outUrl =
          created.video_url || created.url || created.data?.video_url || created.data?.url || '';
        const taskId =
          created.task_id || created.job_id || created.id || created.data?.task_id || created.data?.job_id || created.data?.id || '';
        if (!outUrl && taskId) {
          const pollUrls = [
            `https://api.digen.ai/v2/avatar/status/${encodeURIComponent(taskId)}`,
            `https://api.digen.ai/v1/avatar/status?task_id=${encodeURIComponent(taskId)}`,
            `https://api.digen.ai/v1/tasks/${encodeURIComponent(taskId)}`,
          ];
          const startedAt = Date.now();
          while (Date.now() - startedAt < 35000 && !outUrl) {
            await new Promise((r) => setTimeout(r, 1500));
            for (const pollUrl of pollUrls) {
              const pollRes = await withTimeout(
                fetch(pollUrl, { headers: { Authorization: `Bearer ${resolvedDigen}` } }),
                8000,
                'Digen AI Avatar status'
              );
              if (pollRes.status === 404) continue;
              if (!pollRes.ok) break;
              const statusJson = (await pollRes.json()) as {
                status?: string;
                video_url?: string;
                url?: string;
                data?: { status?: string; video_url?: string; url?: string };
              };
              outUrl =
                statusJson.video_url ||
                statusJson.url ||
                statusJson.data?.video_url ||
                statusJson.data?.url ||
                '';
              if (outUrl) break;
              const s = String(statusJson.status || statusJson.data?.status || '').toLowerCase();
              if (s === 'failed' || s === 'error') break;
            }
          }
        }
        if (outUrl && outUrl.startsWith('https://')) {
          onProgress(88, 'Downloading Talking Avatar MP4 from Digen AI...');
          const mediaRes = await withTimeout(fetch(outUrl), 25000, 'Download Digen AI Avatar');
          if (mediaRes.ok) {
            const blob = await mediaRes.blob();
            return {
              blob,
              mediaUrl: URL.createObjectURL(blob),
              mimeType: blob.type || 'video/mp4',
              width: 512,
              height: 512,
              engineLabel: 'Rendered via Digen AI Avatar',
            };
          }
        }
        break;
      } catch {
        // Try next endpoint / fall through
      }
    }
  }

  const spaces = [
    { spaceId: 'fffiloni/SadTalker', label: 'SadTalker Lip-Sync GPU' },
    { spaceId: 'vinthony/SadTalker', label: 'SadTalker v2 GPU' },
  ];

  const lipSyncDeadline = Date.now() + 26000;

  for (let i = 0; i < spaces.length; i += 1) {
    if (Date.now() > lipSyncDeadline) break;
    const target = spaces[i];
    try {
      onProgress(20 + i * 8, `Sending portrait & audio to ${target.label}...`);
      const client = await withTimeout(
        opts ? Client.connect(target.spaceId, opts) : Client.connect(target.spaceId),
        7000,
        `Connect ${target.label}`
      );
      const apiInfo = (await withTimeout(client.view_api(), 4500, `Inspect ${target.spaceId}`)) as {
        named_endpoints?: Record<string, { parameters?: GradioParamMeta[] }>;
      };

      const endpoints = Object.keys(apiInfo.named_endpoints ?? {});
      const preferred =
        endpoints.find((e) => /predict|generate|test|inference|run|submit/i.test(e)) || endpoints[0];
      if (!preferred) continue;

      const rawParams = apiInfo.named_endpoints?.[preferred]?.parameters;
      const paramMeta = Array.isArray(rawParams) ? rawParams : [];
      const payloadObj: Record<string, unknown> = {};
      let placedImg = false;
      let placedAudio = false;
      let allNamed = paramMeta.length > 0;

      for (const p of paramMeta) {
        const key = p.parameter_name?.trim();
        if (!key) {
          allNamed = false;
          break;
        }
        const hint = `${key} ${p.label ?? ''} ${p.component ?? ''}`.toLowerCase();
        if (!placedImg && (hint.includes('image') || hint.includes('face') || hint.includes('source'))) {
          payloadObj[key] = handle_file(imageBlob);
          placedImg = true;
        } else if (!placedAudio && (hint.includes('audio') || hint.includes('voice') || hint.includes('driven'))) {
          payloadObj[key] = handle_file(audioBlob);
          placedAudio = true;
        } else if (key === 'preprocess') {
          payloadObj[key] = 'crop';
        } else if (key === 'still_mode' || key === 'still') {
          payloadObj[key] = true;
        } else if (key === 'use_enhancer') {
          payloadObj[key] = false;
        } else if (key === 'size_of_image' || key === 'size') {
          payloadObj[key] = 256;
        } else if (p.parameter_default !== undefined) {
          payloadObj[key] = p.parameter_default;
        }
      }

      const payload =
        allNamed && placedImg && placedAudio
          ? payloadObj
          : [handle_file(imageBlob), handle_file(audioBlob)];

      const blob = await runBrowserGradioJob({
        spaceId: target.spaceId,
        label: target.label,
        endpoint: preferred,
        payload,
        hfToken: resolvedHf,
        existingClient: client,
        initialMessage: `Animating talking/singing face via ${target.label}...`,
        quickQueueTimeoutMs: resolvedHf ? 13000 : 8000,
        jobTimeoutMs: 22000,
        onProgress,
      });

      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width: 512,
        height: 512,
        engineLabel: 'Rendered via HF Lip-Sync GPU',
      };
    } catch {
      // Try next SadTalker space
    }
  }

  if (resolvedReplicate && audioDataUrl) {
    try {
      onProgress(52, 'Routing portrait + audio to Replicate SadTalker GPU...');
      const createRes = await withTimeout(
        fetch('https://api.replicate.com/v1/models/cjwbw/sadtalker/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resolvedReplicate}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=10',
          },
          body: JSON.stringify({
            input: {
              source_image: imageDataUrl,
              driven_audio: audioDataUrl,
              preprocess: 'crop',
              still_mode: true,
              use_enhancer: false,
            },
          }),
        }),
        12000,
        'Replicate SadTalker submit'
      );
      if (createRes.ok) {
        let pred = (await createRes.json()) as {
          id?: string;
          status?: string;
          output?: string | string[];
          urls?: { get?: string };
        };
        const startedAt = Date.now();
        while ((pred.status === 'starting' || pred.status === 'processing') && Date.now() - startedAt < 35000) {
          await new Promise((r) => setTimeout(r, 1500));
          const pollUrl = pred.urls?.get || (pred.id ? `https://api.replicate.com/v1/predictions/${pred.id}` : '');
          if (!pollUrl) break;
          const pollRes = await withTimeout(
            fetch(pollUrl, { headers: { Authorization: `Bearer ${resolvedReplicate}` } }),
            8000,
            'Replicate SadTalker poll'
          );
          if (!pollRes.ok) break;
          pred = (await pollRes.json()) as typeof pred;
        }
        if (pred.status === 'succeeded') {
          const outUrl =
            typeof pred.output === 'string'
              ? pred.output
              : Array.isArray(pred.output)
              ? pred.output.find((item) => typeof item === 'string')
              : undefined;
          if (outUrl) {
            const mediaRes = await withTimeout(fetch(outUrl), 25000, 'Download Replicate SadTalker MP4');
            if (mediaRes.ok) {
              const blob = await mediaRes.blob();
              return {
                blob,
                mediaUrl: URL.createObjectURL(blob),
                mimeType: blob.type || 'video/mp4',
                width: 512,
                height: 512,
                engineLabel: 'Rendered via Replicate SadTalker',
              };
            }
          }
        }
      }
    } catch {
      // Fall back to CineGen Smart Lip-Sync Animator
    }
  }

  return null;
}
