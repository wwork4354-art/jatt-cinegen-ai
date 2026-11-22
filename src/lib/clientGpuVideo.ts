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
    onProgress,
  } = params;

  onProgress(22, initialMessage);
  const opts = buildConnectOptions(hfToken);
  const client =
    existingClient ??
    (await withTimeout(
      opts ? Client.connect(spaceId, opts) : Client.connect(spaceId),
      12000,
      `Connect ${label}`
    ));

  onProgress(30, `Submitting task to ${label} GPU...`);
  const submission = client.submit(endpoint, payload);

  const hasToken = Boolean(hfToken?.trim());
  const quickQueueTimeoutMs = hasToken ? 25000 : 12000;
  const jobTimeoutMs = 95000;
  const startedAt = Date.now();
  let hasStartedGenerating = false;
  let resultData: unknown = null;

  for await (const rawMsg of submission as AsyncIterable<Record<string, unknown>>) {
    const elapsed = Date.now() - startedAt;

    if (!hasStartedGenerating && elapsed > quickQueueTimeoutMs) {
      throw new Error(`${label} queue busy`);
    }
    if (elapsed > jobTimeoutMs) {
      throw new Error(`${label} GPU timed out`);
    }

    if (rawMsg.type === 'status') {
      const stage = String(rawMsg.stage || '');
      const msgText = typeof rawMsg.message === 'string' ? rawMsg.message : '';
      if (stage === 'error') {
        throw new Error(msgText || `${label} returned an error`);
      }
      if (typeof rawMsg.eta === 'number' && rawMsg.eta > (hasToken ? 90 : 45)) {
        throw new Error(`${label} wait too long (~${Math.round(rawMsg.eta)}s)`);
      }
      if (stage === 'generating') {
        hasStartedGenerating = true;
        onProgress(60, `Generating real AI motion frames via ${label}...`);
      } else if (typeof rawMsg.position === 'number' && rawMsg.position > 0) {
        onProgress(38, `${label} GPU Queue (#${rawMsg.position})...`);
      } else {
        onProgress(42, `Running AI model on ${label}...`);
      }
    } else if (rawMsg.type === 'data') {
      resultData = rawMsg.data;
      break;
    }
  }

  const videoUrl = extractGradioVideoUrl(resultData);
  if (!videoUrl) {
    throw new Error(`${label} did not return a video stream`);
  }

  onProgress(88, `Downloading generated MP4 from ${label}...`);
  const mediaRes = await withTimeout(fetch(videoUrl), 30000, `Download MP4 from ${label}`);
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

export async function runDirectBrowserAiVideo(params: {
  prompt: string;
  mode: 'text-to-video' | 'image-to-video';
  aspectRatio: AspectRatio;
  imageDataUrl?: string;
  geminiKey?: string;
  hfToken?: string;
  onProgress: (percent: number, message: string) => void;
}): Promise<ClientGpuVideoResult | null> {
  const { prompt, mode, aspectRatio, imageDataUrl, geminiKey, hfToken, onProgress } = params;
  const resolvedGemini = geminiKey?.trim() || '';
  const resolvedHf = hfToken?.trim() || '';

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

  const width = aspectRatio === '9:16' ? 512 : aspectRatio === '1:1' ? 512 : 704;
  const height = aspectRatio === '9:16' ? 704 : 512;
  const imageBlob =
    mode === 'image-to-video' && imageDataUrl ? await resolveInputBlob(imageDataUrl) : null;

  if (mode === 'image-to-video' && imageBlob) {
    // Attempt A: Lightricks/ltx-video-distilled (/image_to_video)
    try {
      const blob = await runBrowserGradioJob({
        spaceId: 'Lightricks/ltx-video-distilled',
        label: 'LTX-Video Distilled',
        endpoint: '/image_to_video',
        initialMessage: 'Sending photo to AI GPU for real motion...',
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
          improve_texture_flag: true,
        },
        hfToken: resolvedHf,
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

    // Attempt B: multimodalart/wan2-1-fast (/generate_video)
    try {
      const wanW = aspectRatio === '9:16' ? 512 : aspectRatio === '1:1' ? 512 : 896;
      const wanH = aspectRatio === '9:16' ? 896 : 512;
      const blob = await runBrowserGradioJob({
        spaceId: 'multimodalart/wan2-1-fast',
        label: 'Qwen Wan 2.1',
        endpoint: '/generate_video',
        initialMessage: 'Sending photo to Qwen Wan 2.1 AI GPU for real motion...',
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

    // Attempt C: stabilityai/stable-video-diffusion (/video)
    try {
      const blob = await runBrowserGradioJob({
        spaceId: 'stabilityai/stable-video-diffusion',
        label: 'Stable Video Diffusion',
        endpoint: '/video',
        initialMessage: 'Sending photo to Stable Video Diffusion GPU for real motion...',
        payload: {
          image: handle_file(imageBlob),
          seed: Math.floor(Math.random() * 1000000),
          randomize_seed: true,
          motion_bucket_id: 127,
          fps_id: 6,
        },
        hfToken: resolvedHf,
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
      // Fall through to 3D Parallax Motion fallback cleanly
    }

    return null;
  }

  // Text-to-Video direct browser HF spaces
  try {
    const blob = await runBrowserGradioJob({
      spaceId: 'Lightricks/ltx-video-distilled',
      label: 'LTX-Video Distilled',
      endpoint: '/text_to_video',
      initialMessage: 'Connecting to LTX-Video AI GPU...',
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
        improve_texture_flag: true,
      },
      hfToken: resolvedHf,
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
    return null;
  }
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

  for (let i = 0; i < spaces.length; i += 1) {
    const target = spaces[i];
    try {
      onProgress(20 + i * 8, `Sending portrait & audio to ${target.label}...`);
      const client = await withTimeout(
        opts ? Client.connect(target.spaceId, opts) : Client.connect(target.spaceId),
        12000,
        `Connect ${target.label}`
      );
      const apiInfo = (await withTimeout(client.view_api(), 6000, `Inspect ${target.spaceId}`)) as {
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
