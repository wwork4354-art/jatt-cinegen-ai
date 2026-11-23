import { Client, handle_file } from '@gradio/client';
import type { AspectRatio } from '../types/studio';

export interface ClientGpuVideoResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  engineLabel: string;
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
    await new Promise((r) => setTimeout(r, 4000));

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

export async function runDirectBrowserAiVideo(params: {
  prompt: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  imageDataUrl?: string;
  geminiKey?: string;
  hfToken?: string;
  pollinationsKey?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult | null> {
  const {
    prompt,
    mode,
    aspectRatio,
    imageDataUrl,
    geminiKey,
    hfToken,
    pollinationsKey,
    onProgress,
  } = params;
  const resolvedGemini = geminiKey?.trim() || '';
  const resolvedHf = hfToken?.trim() || '';

  // 0. Pollinations.ai Video API (seedance -> wan -> veo)
  try {
    return await tryDirectBrowserPollinationsVideo({
      prompt,
      aspectRatio,
      imageDataUrl: mode === 'image-to-video' ? imageDataUrl : undefined,
      pollinationsKey,
      onProgress,
    });
  } catch {
    // Fall through to Google Veo / Hugging Face Gradio GPUs
  }

  // 1. Google Veo 2.0
  if (resolvedGemini) {
    try {
      return await tryDirectBrowserGoogleVeo({
        geminiKey: resolvedGemini,
        prompt,
        mode,
        aspectRatio,
        imageDataUrl,
        onProgress,
      });
    } catch {
      // Proceed to Hugging Face Gradio GPUs
    }
  }

  const width = aspectRatio === '9:16' ? 384 : aspectRatio === '1:1' ? 512 : 640;
  const height = aspectRatio === '9:16' ? 640 : aspectRatio === '1:1' ? 512 : 384;
  const imageBlob =
    mode === 'image-to-video' && imageDataUrl ? await resolveInputBlob(imageDataUrl) : null;
  const routerDeadline = Date.now() + 26000;

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
            prompt,
            negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
            input_image_filepath: handle_file(imageBlob),
            input_video_filepath: null,
            height_ui: height,
            width_ui: width,
            mode: 'image-to-video',
            duration_ui: 2,
            ui_frames_to_use: 9,
            seed_ui: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            ui_guidance_scale: 1,
            improve_texture_flag: false,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 11000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        return {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width,
          height,
          engineLabel: 'Rendered via LTX-Video GPU',
        };
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
            prompt,
            height: wanH,
            width: wanW,
            negative_prompt: 'blurry, static, jittery, distorted, watermark, text, low quality',
            duration_seconds: 2,
            guidance_scale: 1,
            steps: 4,
            seed: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 11000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        return {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width: wanW,
          height: wanH,
          engineLabel: 'Rendered via Qwen Wan 2.1',
        };
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
            seed: Math.floor(Math.random() * 1000000),
            randomize_seed: true,
            motion_bucket_id: 127,
            fps_id: 16,
          },
          hfToken: resolvedHf,
          quickQueueTimeoutMs: 10000,
          jobTimeoutMs: 22000,
          onProgress,
        });
        return {
          blob,
          mediaUrl: URL.createObjectURL(blob),
          mimeType: blob.type || 'video/mp4',
          width: 1024,
          height: 576,
          engineLabel: 'Rendered via Stable Video Diffusion GPU',
        };
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
          prompt,
          negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
          input_image_filepath: null,
          input_video_filepath: null,
          height_ui: height,
          width_ui: width,
          mode: 'text-to-video',
          duration_ui: 2,
          ui_frames_to_use: 9,
          seed_ui: Math.floor(Math.random() * 1000000),
          randomize_seed: true,
          ui_guidance_scale: 1,
          improve_texture_flag: false,
        },
        hfToken: resolvedHf,
        quickQueueTimeoutMs: 11000,
        jobTimeoutMs: 22000,
        onProgress,
      });
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width,
        height,
        engineLabel: 'Rendered via LTX-Video GPU',
      };
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
          prompt,
          num_inference_steps: 16,
          guidance_scale: 6,
        },
        hfToken: resolvedHf,
        quickQueueTimeoutMs: 10000,
        jobTimeoutMs: 22000,
        onProgress,
      });
      return {
        blob,
        mediaUrl: URL.createObjectURL(blob),
        mimeType: blob.type || 'video/mp4',
        width: 720,
        height: 480,
        engineLabel: 'Rendered via CogVideoX GPU',
      };
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
  hfToken?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult | null> {
  const { imageDataUrl, audioBlob, hfToken, onProgress } = params;
  const resolvedHf = hfToken?.trim() || '';
  const imageBlob = await resolveInputBlob(imageDataUrl);
  const opts = buildConnectOptions(resolvedHf);

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

      const paramMeta = apiInfo.named_endpoints?.[preferred]?.parameters ?? [];
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

  return null;
}
