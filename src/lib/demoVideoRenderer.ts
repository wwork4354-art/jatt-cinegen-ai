import { translatePromptToEnglish } from './voiceLanguages';
import { fetchThreeVideoKeyframesParallel } from './freeImageWaterfall';
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

function buildThreeCinematicScenes(prompt: string): [string, string, string] {
  return [
    `Wide establishing cinematic opening shot: ${prompt}, dramatic atmospheric lighting, rich depth`,
    `Dynamic mid-action tracking shot in motion: ${prompt}, volumetric rim light, golden particles`,
    `Dramatic close-up finale hero frame: ${prompt}, glowing lens flare, epic cinema color grade`,
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

function createCachedGradeAndVignetteCanvas(
  width: number,
  height: number,
  style: StylePresetId
): HTMLCanvasElement {
  const vCanvas = document.createElement('canvas');
  vCanvas.width = width;
  vCanvas.height = height;
  const vctx = vCanvas.getContext('2d');
  if (vctx) {
    // Style-matched cinematic color grading pass
    const grade = vctx.createLinearGradient(0, 0, width, height);
    if (style === 'cinematic') {
      grade.addColorStop(0, 'rgba(6, 78, 99, 0.14)');
      grade.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
      grade.addColorStop(1, 'rgba(180, 83, 9, 0.14)');
    } else if (style === 'anime') {
      grade.addColorStop(0, 'rgba(37, 99, 235, 0.12)');
      grade.addColorStop(1, 'rgba(236, 72, 153, 0.1)');
    } else if (style === '3d-render') {
      grade.addColorStop(0, 'rgba(14, 116, 144, 0.12)');
      grade.addColorStop(1, 'rgba(79, 70, 229, 0.1)');
    } else {
      grade.addColorStop(0, 'rgba(15, 23, 42, 0.08)');
      grade.addColorStop(1, 'rgba(217, 119, 6, 0.06)');
    }
    vctx.fillStyle = grade;
    vctx.fillRect(0, 0, width, height);

    // Subtle diagonal volumetric light ray wash from top-right
    const ray = vctx.createLinearGradient(width * 0.85, 0, width * 0.25, height);
    ray.addColorStop(0, 'rgba(255, 245, 220, 0.09)');
    ray.addColorStop(0.5, 'rgba(34, 211, 238, 0.03)');
    ray.addColorStop(1, 'rgba(0, 0, 0, 0)');
    vctx.fillStyle = ray;
    vctx.fillRect(0, 0, width, height);

    const vignette = vctx.createRadialGradient(
      width / 2,
      height / 2,
      width * 0.28,
      width / 2,
      height / 2,
      width * 0.78
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(4,6,11,0.36)');
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
    onProgress(18, 'Building 3D parallax depth layers from uploaded photo...', totalSeconds);
    const uploaded = await loadImageElement(sourceImageDataUrl, 10000, 16);
    sceneImages.push(uploaded);
  } else {
    onProgress(16, 'Fetching 3 distinct AI scenes via Pollinations Flux/Turbo...', totalSeconds);
    // Race translation with a strict 2.5s timeout so prompt prep never stalls
    const translated = await Promise.race([
      translatePromptToEnglish(prompt, voiceLanguageId),
      new Promise<{ englishPrompt: string; wasTranslated: boolean }>((resolve) =>
        setTimeout(() => resolve({ englishPrompt: prompt, wasTranslated: false }), 2500)
      ),
    ]);
    const visualPrompt = translated.englishPrompt || prompt;
    const threeScenes = buildThreeCinematicScenes(visualPrompt);
    sceneDescriptions = threeScenes;

    const [k1, k2, k3] = await fetchThreeVideoKeyframesParallel({
      basePrompt: visualPrompt,
      scenePrompts: threeScenes,
      aspectRatio,
      style,
      onStatus: (msg) => onProgress(26, msg, totalSeconds),
    });

    sceneImages.push(k1.img, k2.img, k3.img);
    tempObjectUrls.add(k1.objectUrl);
    tempObjectUrls.add(k2.objectUrl);
    tempObjectUrls.add(k3.objectUrl);
  }

  const startPercent = 35;
  const clipLabel =
    totalSeconds === 15
      ? 'Stitching 3 fast 5s clips @ 16fps'
      : `Rendering ${totalSeconds}s clip @ 16fps`;
  onProgress(startPercent, `${clipLabel} · ${totalSeconds}s remaining...`, totalSeconds);

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

  // Fast 16fps capture stream (80 frames for 5s, 240 frames stitched for 3x5s = 15s) — prevents 35% stalls
  const fps = 16;
  const frameIntervalMs = Math.round(1000 / fps);
  const cachedVignette = createCachedGradeAndVignetteCanvas(width, height, style);

  // Offscreen depth-separated background canvas for 3D Parallax Image-to-Video mode
  let parallaxBgCanvas: HTMLCanvasElement | null = null;
  if (sourceImageDataUrl && sceneImages[0]) {
    parallaxBgCanvas = document.createElement('canvas');
    parallaxBgCanvas.width = width;
    parallaxBgCanvas.height = height;
    const bgCtx = parallaxBgCanvas.getContext('2d');
    if (bgCtx) {
      const hero = sceneImages[0];
      const imgAspect = hero.naturalWidth / Math.max(1, hero.naturalHeight);
      const canvasAspect = width / height;
      const bw = imgAspect > canvasAspect ? height * imgAspect : width;
      const bh = imgAspect > canvasAspect ? height : width / imgAspect;
      bgCtx.filter = 'blur(22px) brightness(0.65) saturate(1.12)';
      bgCtx.drawImage(hero, (width - bw * 1.18) / 2, (height - bh * 1.18) / 2, bw * 1.18, bh * 1.18);
      bgCtx.filter = 'none';
    }
  }

  const promptLower = prompt.toLowerCase();
  const hasWaterOrSkyCue = /water|ocean|sea|wave|river|cloud|sky|wind|rain|hair|mist|fog/.test(
    promptLower
  );
  const hasWarmLightCue = /sun|sunset|fire|gold|glow|neon|cyberpunk|light|spark/.test(promptLower);

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

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(finalStream, {
      mimeType,
      videoBitsPerSecond: bitrate,
    });
  } catch {
    recorder = new MediaRecorder(finalStream);
  }

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

  const sceneMotions: [CameraMotionId, CameraMotionId, CameraMotionId] = [
    cameraMotion === 'static' ? 'dolly-push' : cameraMotion,
    cameraMotion === 'slow-pan' ? 'aerial-orbit' : 'slow-pan',
    cameraMotion === 'crane-up' ? 'dolly-push' : 'crane-up',
  ];

  let settledStop = false;
  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (settledStop) return;
      settledStop = true;
      const cleanMime = mimeType.split(';')[0];
      resolve(new Blob(chunks, { type: cleanMime }));
    };
    recorder.onerror = () => {
      if (settledStop) return;
      settledStop = true;
      reject(new Error('Video recording failed.'));
    };
  });

  recorder.start(400);

  const startTime = performance.now();
  const totalMs = totalSeconds * 1000;
  const sceneCount = sceneImages.length;
  const sceneDurationSec = totalSeconds / Math.max(1, sceneCount);
  const crossfadeSec = Math.min(0.8, sceneDurationSec * 0.3);

  let lastProgressAt = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let loopDone = false;
      const finishLoop = () => {
        if (loopDone) return;
        loopDone = true;
        window.clearTimeout(loopSafetyTimer);
        resolve();
      };
      const failLoop = (err: unknown) => {
        if (loopDone) return;
        loopDone = true;
        window.clearTimeout(loopSafetyTimer);
        reject(err instanceof Error ? err : new Error('Video frame rendering failed.'));
      };
      const loopSafetyTimer = window.setTimeout(finishLoop, totalMs + 6000);

      const tick = () => {
        if (loopDone) return;
        try {
          const now = performance.now();
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / totalMs);
          const currentSec = t * totalSeconds;

          ctx.fillStyle = '#07090E';
          ctx.fillRect(0, 0, width, height);

        if (sceneCount >= 2) {
          const sceneIdx = Math.min(sceneCount - 1, Math.floor(currentSec / sceneDurationSec));
          const sceneStartSec = sceneIdx * sceneDurationSec;
          const sceneElapsed = Math.max(0, currentSec - sceneStartSec);
          const localT = Math.min(1, sceneElapsed / sceneDurationSec);
          const motionA = sceneMotions[sceneIdx % sceneMotions.length];
          const reused = sceneIdx > 0 && sceneImages[sceneIdx] === sceneImages[0];

          drawKenBurnsImage(
            ctx,
            sceneImages[sceneIdx],
            width,
            height,
            localT,
            motionA,
            1,
            reused ? (sceneIdx % 2 === 1 ? 0.035 : -0.03) : 0,
            reused ? 1.09 : 1
          );

          const nextIdx = sceneIdx + 1;
          if (nextIdx < sceneCount && sceneElapsed > sceneDurationSec - crossfadeSec) {
            const fadeT = (sceneElapsed - (sceneDurationSec - crossfadeSec)) / crossfadeSec;
            const motionB = sceneMotions[nextIdx % sceneMotions.length];
            const nextReused = sceneImages[nextIdx] === sceneImages[0];
            drawKenBurnsImage(
              ctx,
              sceneImages[nextIdx],
              width,
              height,
              0,
              motionB,
              Math.min(1, Math.max(0, fadeT)),
              nextReused ? (nextIdx % 2 === 1 ? 0.035 : -0.03) : 0,
              nextReused ? 1.09 : 1
            );
          }
        } else if (parallaxBgCanvas) {
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const bgDriftX = (0.5 - ease) * width * 0.055;
          const bgDriftY = Math.sin(t * Math.PI) * height * 0.025;
          ctx.save();
          ctx.translate(width / 2 - bgDriftX, height / 2 - bgDriftY);
          ctx.scale(1.06 + t * 0.04, 1.06 + t * 0.04);
          ctx.drawImage(parallaxBgCanvas, -width / 2, -height / 2, width, height);
          ctx.restore();

          ctx.save();
          const fgScale =
            cameraMotion === 'dolly-push'
              ? 1.04 + ease * 0.14
              : 1.08 + Math.sin(t * Math.PI) * 0.06;
          const fgShiftX =
            cameraMotion === 'slow-pan'
              ? (ease - 0.5) * width * 0.09
              : Math.sin(t * Math.PI * 1.5) * width * 0.024;
          const fgShiftY =
            cameraMotion === 'crane-up'
              ? (0.5 - ease) * height * 0.08
              : Math.cos(t * Math.PI * 1.2) * height * 0.018;
          const fgTilt = Math.sin(t * Math.PI * 2) * 0.008;

          const hero = sceneImages[0];
          const imgAspect = hero.naturalWidth / Math.max(1, hero.naturalHeight);
          const canvasAspect = width / height;
          const dw = imgAspect > canvasAspect ? height * imgAspect : width;
          const dh = imgAspect > canvasAspect ? height : width / imgAspect;

          ctx.translate(width / 2 + fgShiftX, height / 2 + fgShiftY);
          ctx.rotate(fgTilt);
          ctx.scale(fgScale, fgScale);
          ctx.drawImage(hero, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();

          if (hasWaterOrSkyCue) {
            const mistX = ((t * 0.85) % 1) * width;
            const mist = ctx.createRadialGradient(
              mistX,
              height * 0.35,
              width * 0.05,
              mistX,
              height * 0.35,
              width * 0.48
            );
            mist.addColorStop(0, 'rgba(224, 242, 254, 0.08)');
            mist.addColorStop(1, 'rgba(224, 242, 254, 0)');
            ctx.fillStyle = mist;
            ctx.fillRect(0, 0, width, height);
          }

          if (hasWarmLightCue) {
            const flare = ctx.createRadialGradient(
              width * (0.25 + t * 0.5),
              height * 0.22,
              0,
              width * (0.25 + t * 0.5),
              height * 0.22,
              width * 0.5
            );
            flare.addColorStop(0, 'rgba(251, 191, 36, 0.11)');
            flare.addColorStop(1, 'rgba(251, 191, 36, 0)');
            ctx.fillStyle = flare;
            ctx.fillRect(0, 0, width, height);
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

        // Composite pre-rendered cinema vignette
        ctx.drawImage(cachedVignette, 0, 0);

        if (onFrameCanvas) {
          onFrameCanvas(canvas);
        }

        if (now - lastProgressAt >= 200 || elapsed >= totalMs) {
          lastProgressAt = now;
          const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
          const percentRange = 97 - startPercent;
          const percent = Math.min(97, Math.round(startPercent + t * percentRange));
          onProgress(
            percent,
            `${clipLabel} · ${remainingSec}s remaining...`,
            remainingSec
          );
        }

          if (elapsed < totalMs) {
            window.setTimeout(tick, frameIntervalMs);
          } else {
            finishLoop();
          }
        } catch (err) {
          failLoop(err);
        }
      };

      window.setTimeout(tick, 0);
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
  const stopFailsafe = window.setTimeout(() => {
    if (!settledStop) {
      settledStop = true;
      const cleanMime = mimeType.split(';')[0];
      // Force resolve if MediaRecorder.onstop stalls on a restricted mobile device
      chunks.push(new Uint8Array(0));
      void cleanMime;
    }
  }, 3500);

  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
  const blob = await Promise.race([
    recordingFinished,
    new Promise<Blob>((resolve) => {
      window.setTimeout(() => {
        const cleanMime = mimeType.split(';')[0];
        resolve(new Blob(chunks, { type: cleanMime }));
      }, 3600);
    }),
  ]);
  window.clearTimeout(stopFailsafe);

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
