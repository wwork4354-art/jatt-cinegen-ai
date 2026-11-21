import { translatePromptToEnglish } from './voiceLanguages';
import { fetchFastVideoKeyframesParallel } from './freeImageWaterfall';
import {
  type AspectRatio,
  type CameraMotionId,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
} from '../types/studio';

interface RenderDemoVideoParams {
  prompt: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  cameraMotion: CameraMotionId;
  quality: VideoQuality;
  style: StylePresetId;
  sourceImageDataUrl?: string;
  backgroundMusicFile?: File | null;
  voiceoverEnabled?: boolean;
  speechLocale?: string;
  voiceLanguageId?: string;
  onFrameCanvas?: (sourceCanvas: HTMLCanvasElement) => void;
  onProgress: (
    percent: number,
    statusMessage: string,
    remainingSeconds?: number
  ) => void;
}

export interface RenderedVideoResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  scenes?: string[];
}

function getDimensions(aspectRatio: AspectRatio, quality: VideoQuality): { width: number; height: number } {
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

function loadImageElement(src: string, timeoutMs = 10000, minDimension = 16): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => {
      reject(new Error('Image request timed out'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      if (img.naturalWidth < minDimension || img.naturalHeight < minDimension) {
        reject(new Error('Received invalid image dimensions'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Uploaded image failed to load'));
    };
    img.src = src;
  });
}

function buildFastTwoScenes(prompt: string): [string, string] {
  return [
    `Wide establishing cinematic opening shot: ${prompt}, dramatic atmospheric lighting, rich depth`,
    `Dynamic action finale close-up in full motion: ${prompt}, vivid volumetric rim light, epic climax`,
  ];
}

function chooseSupportedMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ]
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function drawKenBurnsImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  localT: number,
  motion: CameraMotionId,
  alpha = 1,
  cropBiasX = 0,
  baseZoomBoost = 1
) {
  const ease = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;

  let scale = 1.07 * baseZoomBoost;
  let offsetX = cropBiasX * width;
  let offsetY = 0;
  let rotation = 0;

  switch (motion) {
    case 'dolly-push':
      scale = (1.03 + ease * 0.16) * baseZoomBoost;
      offsetX += Math.sin(localT * Math.PI) * width * 0.016;
      break;
    case 'slow-pan':
      scale = 1.16 * baseZoomBoost;
      offsetX += (0.5 - ease) * width * 0.11;
      break;
    case 'aerial-orbit':
      scale = 1.16 * baseZoomBoost;
      offsetX += Math.sin(localT * Math.PI * 2) * width * 0.042;
      offsetY += Math.cos(localT * Math.PI * 2) * height * 0.028;
      rotation = Math.sin(localT * Math.PI * 2) * 0.014;
      break;
    case 'crane-up':
      scale = 1.16 * baseZoomBoost;
      offsetY += (0.5 - ease) * height * 0.1;
      break;
    case 'handheld-drift':
      scale = 1.12 * baseZoomBoost;
      offsetX += Math.sin(localT * 10.5) * width * 0.013 + Math.cos(localT * 4.7) * width * 0.008;
      offsetY += Math.cos(localT * 8.4) * height * 0.011;
      rotation = Math.sin(localT * 7.2) * 0.008;
      break;
    case 'static':
    default:
      scale = (1.03 + Math.sin(localT * Math.PI) * 0.025) * baseZoomBoost;
      break;
  }

  if (motion !== 'static') {
    offsetX += Math.sin(localT * 24) * width * 0.002 + Math.cos(localT * 14) * width * 0.0014;
    offsetY += Math.cos(localT * 21) * height * 0.002;
    rotation += Math.sin(localT * 18) * 0.0012;
  }

  const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const canvasAspect = width / height;
  let drawW = width;
  let drawH = height;
  if (imgAspect > canvasAspect) {
    drawH = height;
    drawW = height * imgAspect;
  } else {
    drawW = width;
    drawH = width / imgAspect;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function createCachedVignetteCanvas(width: number, height: number): HTMLCanvasElement {
  const vCanvas = document.createElement('canvas');
  vCanvas.width = width;
  vCanvas.height = height;
  const vctx = vCanvas.getContext('2d');
  if (vctx) {
    const vignette = vctx.createRadialGradient(
      width / 2,
      height / 2,
      width * 0.28,
      width / 2,
      height / 2,
      width * 0.78
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(4,6,11,0.34)');
    vctx.fillStyle = vignette;
    vctx.fillRect(0, 0, width, height);
  }
  return vCanvas;
}

export async function renderDemoVideo({
  prompt,
  aspectRatio,
  duration,
  cameraMotion,
  quality,
  style,
  sourceImageDataUrl,
  backgroundMusicFile,
  voiceoverEnabled,
  speechLocale = 'en-US',
  voiceLanguageId,
  onFrameCanvas,
  onProgress,
}: RenderDemoVideoParams): Promise<RenderedVideoResult> {
  const { width, height } = getDimensions(aspectRatio, quality);
  const totalSeconds = duration === '15s' ? 15 : duration === '10s' ? 10 : 5;

  const sceneImages: HTMLImageElement[] = [];
  const tempObjectUrls = new Set<string>();
  let sceneDescriptions: string[] | undefined;

  if (sourceImageDataUrl) {
    onProgress(12, 'Preparing uploaded image...', totalSeconds);
    const uploaded = await loadImageElement(sourceImageDataUrl, 10000, 16);
    sceneImages.push(uploaded);
  } else {
    onProgress(10, 'Preparing fast AI keyframes...', totalSeconds);
    // Race translation with a strict 2.5s timeout so prompt prep never stalls
    const translated = await Promise.race([
      translatePromptToEnglish(prompt, voiceLanguageId),
      new Promise<{ englishPrompt: string; wasTranslated: boolean }>((resolve) =>
        setTimeout(() => resolve({ englishPrompt: prompt, wasTranslated: false }), 2500)
      ),
    ]);
    const visualPrompt = translated.englishPrompt || prompt;
    const fastScenes = buildFastTwoScenes(visualPrompt);
    sceneDescriptions = fastScenes;

    const [k1, k2] = await fetchFastVideoKeyframesParallel({
      scenePrompts: fastScenes,
      aspectRatio,
      style,
      onStatus: (msg) => onProgress(22, msg, totalSeconds),
    });

    sceneImages.push(k1.img, k2.img);
    tempObjectUrls.add(k1.objectUrl);
    tempObjectUrls.add(k2.objectUrl);
  }

  const startPercent = 35;
  onProgress(startPercent, `Rendering ${totalSeconds}s @ 30fps · ${totalSeconds}s remaining...`, totalSeconds);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Browser canvas 2D context is unavailable.');
  }

  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support MediaRecorder video encoding.');
  }

  // Fast 30fps capture stream with cached static vignette overlay for 3GB RAM efficiency
  const fps = 30;
  const frameIntervalMs = 1000 / fps;
  const cachedVignette = createCachedVignetteCanvas(width, height);
  const videoStream = canvas.captureStream(fps);
  const combinedTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  let audioContext: AudioContext | null = null;
  let audioSourceNode: AudioBufferSourceNode | null = null;

  if (backgroundMusicFile) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioCtx();
      const arrayBuf = await backgroundMusicFile.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuf);
      const dest = audioContext.createMediaStreamDestination();
      audioSourceNode = audioContext.createBufferSource();
      audioSourceNode.buffer = audioBuffer;
      audioSourceNode.loop = true;
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.72;
      audioSourceNode.connect(gainNode);
      gainNode.connect(dest);
      audioSourceNode.start(0);
      combinedTracks.push(...dest.stream.getAudioTracks());
    } catch {
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
    }
  }

  if (voiceoverEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(prompt);
      utterance.lang = speechLocale;
      utterance.rate = 0.96;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis errors on restricted devices
    }
  }

  const finalStream = new MediaStream(combinedTracks);
  const hasAudio = combinedTracks.some((t) => t.kind === 'audio');
  const mimeType = chooseSupportedMimeType(hasAudio);
  const bitrate = quality === '4k' ? 14_000_000 : quality === '1080p' ? 6_500_000 : 3_200_000;

  const recorder = new MediaRecorder(finalStream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  // Lightweight particle set (24) pre-computed for smooth 30fps rendering on 3GB RAM phones
  const particles = Array.from({ length: 24 }, (_, idx) => ({
    x: ((idx * 197) % 1000) / 1000,
    y: ((idx * 353) % 1000) / 1000,
    radius: (idx % 6 === 0 ? 3.4 : 1.3 + (idx % 3) * 0.65) * (width / 1280),
    speedX: ((idx % 5) - 2) * 0.0045,
    speedY: -0.007 - (idx % 3) * 0.0035,
    fillStyle: idx % 6 === 0 ? 'rgba(165, 243, 252, 0.12)' : 'rgba(165, 243, 252, 0.2)',
  }));

  const sceneMotions: [CameraMotionId, CameraMotionId] = [
    cameraMotion === 'static' ? 'dolly-push' : cameraMotion,
    cameraMotion === 'slow-pan' ? 'aerial-orbit' : 'slow-pan',
  ];

  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const cleanMime = mimeType.split(';')[0];
      resolve(new Blob(chunks, { type: cleanMime }));
    };
    recorder.onerror = () => reject(new Error('Video recording failed.'));
  });

  recorder.start(500);

  const startTime = performance.now();
  const totalMs = totalSeconds * 1000;
  const crossfadeSec = 0.75;
  const hasTwoScenes = sceneImages.length >= 2;
  const splitSec = totalSeconds / 2;

  let lastFrameAt = 0;
  let lastProgressAt = 0;

  try {
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const elapsed = now - startTime;
        if (elapsed < totalMs && now - lastFrameAt < frameIntervalMs - 2) {
          requestAnimationFrame(tick);
          return;
        }
        lastFrameAt = now;

        const t = Math.min(1, elapsed / totalMs);
        const currentSec = t * totalSeconds;

        ctx.fillStyle = '#07090E';
        ctx.fillRect(0, 0, width, height);

        if (hasTwoScenes) {
          const inScene2 = currentSec >= splitSec;
          const sceneIdx = inScene2 ? 1 : 0;
          const sceneElapsed = inScene2 ? currentSec - splitSec : currentSec;
          const localT = Math.min(1, sceneElapsed / splitSec);
          const reused = sceneImages[1] === sceneImages[0];

          drawKenBurnsImage(
            ctx,
            sceneImages[sceneIdx],
            width,
            height,
            localT,
            sceneMotions[sceneIdx],
            1,
            reused ? (sceneIdx === 1 ? 0.035 : -0.025) : 0,
            reused && sceneIdx === 1 ? 1.09 : 1
          );

          if (sceneIdx === 0 && currentSec > splitSec - crossfadeSec) {
            const fadeT = (currentSec - (splitSec - crossfadeSec)) / crossfadeSec;
            drawKenBurnsImage(
              ctx,
              sceneImages[1],
              width,
              height,
              0,
              sceneMotions[1],
              Math.min(1, Math.max(0, fadeT)),
              reused ? 0.035 : 0,
              reused ? 1.09 : 1
            );
          }
        } else {
          drawKenBurnsImage(ctx, sceneImages[0], width, height, t, cameraMotion, 1);
        }

        // Dynamic atmospheric light sweep
        const sweepX = (t * 1.35 - 0.18) * width;
        const beam = ctx.createLinearGradient(
          sweepX - width * 0.22,
          0,
          sweepX + width * 0.22,
          height
        );
        beam.addColorStop(0, 'rgba(255, 255, 255, 0)');
        beam.addColorStop(0.5, 'rgba(34, 211, 238, 0.065)');
        beam.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beam;
        ctx.fillRect(0, 0, width, height);

        // Lightweight glowing particles
        for (const p of particles) {
          const px = (((p.x + t * p.speedX * 12) % 1) + 1) % 1 * width;
          const py = (((p.y + t * p.speedY * 12) % 1) + 1) % 1 * height;
          ctx.fillStyle = p.fillStyle;
          ctx.beginPath();
          ctx.arc(px, py, p.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Composite pre-rendered cinema vignette (zero per-frame gradient allocation)
        ctx.drawImage(cachedVignette, 0, 0);

        if (onFrameCanvas) {
          onFrameCanvas(canvas);
        }

        // Throttle React progress state updates to 4Hz (every 250ms) to avoid 3GB RAM UI lag
        if (now - lastProgressAt >= 250 || elapsed >= totalMs) {
          lastProgressAt = now;
          const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
          const percentRange = 97 - startPercent;
          const percent = Math.min(97, Math.round(startPercent + t * percentRange));
          onProgress(
            percent,
            `Rendering ${totalSeconds}s Video · ${remainingSec}s remaining...`,
            remainingSec
          );
        }

        if (elapsed < totalMs) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(tick);
    });
  } finally {
    if (audioSourceNode) {
      try {
        audioSourceNode.stop();
      } catch {
        // Ignore stop error
      }
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
    }
  }

  onProgress(99, 'Finalizing downloadable video...', 0);
  recorder.stop();
  const blob = await recordingFinished;
  for (const tempUrl of tempObjectUrls) {
    URL.revokeObjectURL(tempUrl);
  }
  const mediaUrl = URL.createObjectURL(blob);
  onProgress(100, 'Video ready.', 0);

  return {
    blob,
    mediaUrl,
    mimeType: blob.type || 'video/webm',
    width,
    height,
    scenes: sceneDescriptions,
  };
}
