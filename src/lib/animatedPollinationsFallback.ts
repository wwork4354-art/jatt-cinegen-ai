import {
  fetchThreeVideoKeyframesParallel,
  type FastKeyframeResult,
} from './freeImageWaterfall';
import type {
  AspectRatio,
  CameraMotionId,
  StylePresetId,
  VideoDuration,
  VideoQuality,
} from '../types/studio';

export interface AnimatedFallbackResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  scenes?: string[];
}

export interface AnimatedFallbackParams {
  mode: 'text-to-video' | 'image-to-video';
  prompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  duration: VideoDuration;
  cameraMotion: CameraMotionId;
  quality: VideoQuality;
  imageDataUrl?: string;
  voiceoverEnabled?: boolean;
  voiceTranslateCode?: string;
  backgroundMusicFile?: File | null;
  onFrameCanvas?: (sourceCanvas: HTMLCanvasElement) => void;
  onProgress: (
    percent: number,
    statusMessage: string,
    remainingSeconds?: number
  ) => void;
}

function getDimensions(
  aspectRatio: AspectRatio,
  quality: VideoQuality
): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    if (quality === '4k') return { width: 2160, height: 3840 };
    return quality === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  if (aspectRatio === '1:1') {
    if (quality === '4k') return { width: 2160, height: 2160 };
    return quality === '1080p' ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  if (quality === '4k') return { width: 3840, height: 2160 };
  return quality === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function chooseSupportedMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Reference image failed to decode for animation.'));
    img.src = src;
  });
}

function drawCoverMotion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasW: number,
  canvasH: number,
  localT: number,
  cameraMotion: CameraMotionId,
  alpha: number,
  sceneIndex: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const canvasAspect = canvasW / canvasH;
  let drawW = canvasW;
  let drawH = canvasH;
  if (imgAspect > canvasAspect) {
    drawH = canvasH;
    drawW = canvasH * imgAspect;
  } else {
    drawW = canvasW;
    drawH = canvasW / imgAspect;
  }

  let scale = 1.05;
  let panX = 0;
  let panY = 0;
  const dir = sceneIndex % 2 === 0 ? 1 : -1;

  switch (cameraMotion) {
    case 'dolly-push':
      scale = 1.04 + 0.14 * localT;
      panY = -canvasH * 0.01 * localT;
      break;
    case 'slow-pan':
      scale = 1.14;
      panX = dir * canvasW * 0.055 * (localT - 0.5);
      break;
    case 'aerial-orbit':
      scale = 1.13 + 0.04 * Math.sin(localT * Math.PI);
      panX = Math.sin(localT * Math.PI * 1.1) * canvasW * 0.032 * dir;
      panY = Math.cos(localT * Math.PI * 0.9) * canvasH * 0.022;
      break;
    case 'crane-up':
      scale = 1.14;
      panY = canvasH * 0.05 * (0.5 - localT);
      break;
    case 'handheld-drift':
      scale = 1.1;
      panX = Math.sin(localT * Math.PI * 3) * canvasW * 0.018;
      panY = Math.cos(localT * Math.PI * 2.5) * canvasH * 0.014;
      break;
    case 'static':
    default:
      scale = 1.02 + 0.02 * Math.sin(localT * Math.PI);
      break;
  }

  const finalW = drawW * scale;
  const finalH = drawH * scale;
  const dx = (canvasW - finalW) / 2 + panX;
  const dy = (canvasH - finalH) / 2 + panY;

  ctx.drawImage(img, dx, dy, finalW, finalH);
  ctx.restore();
}

async function resolveScenePrompts(prompt: string, style: StylePresetId): Promise<[string, string, string]> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/expand-scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ prompt, style }),
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { scenes?: string[] };
      if (Array.isArray(data.scenes) && data.scenes.length >= 3) {
        return [data.scenes[0], data.scenes[1], data.scenes[2]];
      }
    }
  } catch {
    // Use local progressive shot breakdown fallback
  }

  return [
    `Wide establishing shot, ${prompt}, atmospheric depth`,
    `Dynamic medium action shot in motion, ${prompt}, dramatic lighting`,
    `Cinematic close-up finale, ${prompt}, crisp golden rim light`,
  ];
}

export async function renderAnimatedPollinationsFallback(
  params: AnimatedFallbackParams
): Promise<AnimatedFallbackResult> {
  const {
    mode,
    prompt,
    aspectRatio,
    style,
    duration,
    cameraMotion,
    quality,
    imageDataUrl,
    voiceoverEnabled,
    voiceTranslateCode = 'en',
    backgroundMusicFile,
    onFrameCanvas,
    onProgress,
  } = params;

  const { width, height } = getDimensions(aspectRatio, quality);
  const totalSeconds = duration === '5s' ? 5 : duration === '10s' ? 10 : 15;

  const cleanupUrls: string[] = [];
  let keyframes: HTMLImageElement[] = [];
  let sceneDescriptions: string[] | undefined;

  if (mode === 'image-to-video' && imageDataUrl) {
    onProgress(52, 'Video APIs busy — animating your photo via Pollinations fallback...');
    const refImg = await loadImageElement(imageDataUrl);
    keyframes = [refImg];
  } else {
    onProgress(48, 'Video APIs unavailable — fetching Pollinations AI scenes for fallback...');
    const scenePrompts = await resolveScenePrompts(prompt, style);
    sceneDescriptions = scenePrompts;
    const fetched: [FastKeyframeResult, FastKeyframeResult, FastKeyframeResult] =
      await fetchThreeVideoKeyframesParallel({
        basePrompt: prompt,
        scenePrompts,
        aspectRatio,
        style,
        onStatus: (msg) => onProgress(58, msg),
      });
    keyframes = fetched.map((f) => {
      cleanupUrls.push(f.objectUrl);
      return f.img;
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    for (const u of cleanupUrls) URL.revokeObjectURL(u);
    throw new Error('Browser 2D canvas unavailable for fallback animation.');
  }
  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    for (const u of cleanupUrls) URL.revokeObjectURL(u);
    throw new Error('Browser does not support MediaRecorder fallback export.');
  }

  const fps = 20;
  const frameIntervalMs = Math.round(1000 / fps);
  const videoStream = canvas.captureStream(fps);
  const combinedTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  let audioContext: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;

  const attachAudioBuffer = async (
    audioBufData: ArrayBuffer
  ): Promise<{ context: AudioContext; source: AudioBufferSourceNode }> => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctxInstance = new AudioCtx();
    try {
      const decoded = await ctxInstance.decodeAudioData(audioBufData);
      const dest = ctxInstance.createMediaStreamDestination();
      const gain = ctxInstance.createGain();
      gain.gain.value = 0.85;
      const srcNode = ctxInstance.createBufferSource();
      srcNode.buffer = decoded;
      srcNode.loop = true;
      srcNode.connect(gain);
      gain.connect(dest);
      srcNode.start(0);
      combinedTracks.push(...dest.stream.getAudioTracks());
      return { context: ctxInstance, source: srcNode };
    } catch (err) {
      ctxInstance.close().catch(() => {});
      throw err;
    }
  };

  if (backgroundMusicFile) {
    try {
      const attached = await attachAudioBuffer(await backgroundMusicFile.arrayBuffer());
      audioContext = attached.context;
      audioSource = attached.source;
    } catch {
      audioContext = null;
      audioSource = null;
    }
  } else if (voiceoverEnabled && prompt.trim()) {
    try {
      const res = await fetch('/api/tts-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt.trim(), languageCode: voiceTranslateCode }),
      });
      if (res.ok) {
        const data = (await res.json()) as { audioDataUrl?: string };
        if (data.audioDataUrl) {
          const audioResp = await fetch(data.audioDataUrl);
          const attached = await attachAudioBuffer(await audioResp.arrayBuffer());
          audioContext = attached.context;
          audioSource = attached.source;
        }
      }
    } catch {
      // Silent video fallback if TTS unavailable
    }
  }

  const finalStream = new MediaStream(combinedTracks);
  const hasAudio = combinedTracks.some((t) => t.kind === 'audio');
  const mimeType = chooseSupportedMimeType(hasAudio);
  const bitrate = quality === '4k' ? 12_000_000 : quality === '1080p' ? 5_800_000 : 3_000_000;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(finalStream, { mimeType, videoBitsPerSecond: bitrate });
  } catch {
    recorder = new MediaRecorder(finalStream);
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const finalType = recorder.mimeType || mimeType;
      const blob = new Blob(chunks, { type: finalType });
      if (blob.size < 2000) {
        reject(new Error('Animated fallback recording produced an empty file.'));
        return;
      }
      resolve(blob);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder failed during fallback render.'));
  });

  onProgress(68, 'Rendering animated Pollinations AI fallback video...');
  recorder.start(250);

  const totalFrames = totalSeconds * fps;
  const startTime = performance.now();
  const sceneCount = keyframes.length;

  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const globalT = frame / Math.max(1, totalFrames - 1);
      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, width, height);

      if (sceneCount === 1) {
        drawCoverMotion(ctx, keyframes[0], width, height, globalT, cameraMotion, 1, 0);
      } else {
        const sceneFloat = globalT * sceneCount;
        const idx = Math.min(sceneCount - 1, Math.floor(sceneFloat));
        const nextIdx = Math.min(sceneCount - 1, idx + 1);
        const localT = sceneFloat - idx;
        const fadeWindow = 0.22;

        drawCoverMotion(ctx, keyframes[idx], width, height, localT, cameraMotion, 1, idx);
        if (idx !== nextIdx && localT > 1 - fadeWindow) {
          const blend = (localT - (1 - fadeWindow)) / fadeWindow;
          drawCoverMotion(
            ctx,
            keyframes[nextIdx],
            width,
            height,
            blend * 0.2,
            cameraMotion,
            Math.min(1, Math.max(0, blend)),
            nextIdx
          );
        }
      }

      // Subtle atmospheric film vignette
      const vig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      onFrameCanvas?.(canvas);

      if (frame % 4 === 0 || frame === totalFrames - 1) {
        const pct = Math.min(96, 68 + Math.round(globalT * 28));
        const rem = Math.max(0, Math.ceil(totalSeconds * (1 - globalT)));
        onProgress(pct, 'Encoding animated Pollinations AI fallback...', rem);
      }

      const targetTime = startTime + (frame + 1) * frameIntervalMs;
      const waitMs = targetTime - performance.now();
      if (waitMs > 1) {
        await new Promise((r) => window.setTimeout(r, waitMs));
      } else {
        await new Promise((r) => window.setTimeout(r, 0));
      }
    }
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    if (audioSource) {
      try {
        audioSource.stop();
      } catch {
        // Ignore already-stopped audio source
      }
    }
    if (audioContext) {
      (audioContext as AudioContext).close().catch(() => {});
    }
    for (const track of videoStream.getTracks()) {
      track.stop();
    }
    for (const u of cleanupUrls) {
      URL.revokeObjectURL(u);
    }
  }

  const blob = await recordingFinished;
  return {
    blob,
    mediaUrl: URL.createObjectURL(blob),
    mimeType: blob.type || mimeType,
    width,
    height,
    scenes: sceneDescriptions,
  };
}
