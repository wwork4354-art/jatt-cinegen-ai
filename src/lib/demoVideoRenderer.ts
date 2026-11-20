import {
  buildPollinationsFastKeyframeUrl,
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

function loadImageElement(src: string, timeoutMs = 15000, minDimension = 200): Promise<HTMLImageElement> {
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
      reject(new Error('Pollinations image request failed'));
    };
    img.src = src;
  });
}

function isLikelyRateLimitBanner(img: HTMLImageElement, targetWidth: number, targetHeight: number): boolean {
  const targetRatio = targetWidth / targetHeight;
  const actualRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  if (Math.abs(targetRatio - actualRatio) > 0.35) {
    return true;
  }

  try {
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 48;
    const pctx = probe.getContext('2d');
    if (!pctx) return false;
    pctx.drawImage(img, 0, 0, 48, 48);
    const data = pctx.getImageData(0, 0, 48, 48).data;
    const firstR = data[0];
    const firstG = data[1];
    const firstB = data[2];
    let uniformPixels = 0;
    const totalPixels = 48 * 48;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i] - firstR);
      const dg = Math.abs(data[i + 1] - firstG);
      const db = Math.abs(data[i + 2] - firstB);
      if (dr + dg + db < 16) {
        uniformPixels += 1;
      }
    }
    return uniformPixels / totalPixels > 0.72;
  } catch {
    return false;
  }
}

async function fetchPollinationsImageWithRetries(
  scenePrompt: string,
  aspectRatio: AspectRatio,
  style: StylePresetId,
  seed: number,
  onAttemptStatus: (msg: string) => void
): Promise<HTMLImageElement> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { url, fetchWidth, fetchHeight } = buildPollinationsFastKeyframeUrl(
      scenePrompt,
      aspectRatio,
      style,
      seed + attempt * 31
    );

    try {
      const img = await loadImageElement(url, 15000);
      if (isLikelyRateLimitBanner(img, fetchWidth, fetchHeight)) {
        throw new Error('Pollinations returned a temporary rate-limit banner');
      }
      return img;
    } catch (err) {
      if (attempt < maxAttempts) {
        onAttemptStatus(
          `Generating AI Scene... (Retry ${attempt}/${maxAttempts - 1} in 4s)`
        );
        await new Promise((resolve) => setTimeout(resolve, 4000));
      } else {
        throw err instanceof Error
          ? err
          : new Error('Unable to load AI scene image from Pollinations.');
      }
    }
  }

  throw new Error('Unable to load AI scene image from Pollinations.');
}

function buildSequentialScenes(prompt: string): [string, string, string] {
  return [
    `Wide establishing cinematic opening shot: ${prompt}, dramatic atmospheric lighting, deep perspective`,
    `Dynamic action mid-shot in full motion: ${prompt}, intense dramatic lighting, vivid detail`,
    `Sweeping cinematic finale shot: ${prompt}, golden hour rim light, epic closing composition`,
  ];
}

async function expandPromptToScenes(
  prompt: string,
  style: StylePresetId,
  cameraMotion: CameraMotionId
): Promise<[string, string, string]> {
  try {
    const res = await fetch('/api/expand-scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, style, cameraMotion }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json()) as { scenes?: string[] };
      if (Array.isArray(data.scenes) && data.scenes.length >= 3) {
        return [data.scenes[0], data.scenes[1], data.scenes[2]];
      }
    }
  } catch {
    // Fallback cleanly when Gemini key isn't configured
  }
  return buildSequentialScenes(prompt);
}

function chooseSupportedMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ]
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
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

  // Subtle organic camera shake
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
  onFrameCanvas,
  onProgress,
}: RenderDemoVideoParams): Promise<RenderedVideoResult> {
  const { width, height } = getDimensions(aspectRatio, quality);
  const totalSeconds = duration === '15s' ? 15 : duration === '10s' ? 10 : 5;
  const isMultiScene15s = duration === '15s' && !sourceImageDataUrl;

  const sceneImages: HTMLImageElement[] = [];
  let sceneDescriptions: string[] | undefined;

  if (sourceImageDataUrl) {
    onProgress(8, 'Preparing uploaded image...', totalSeconds);
    const uploaded = await loadImageElement(sourceImageDataUrl, 15000, 16);
    sceneImages.push(uploaded);
  } else if (isMultiScene15s) {
    onProgress(6, 'Generating AI Scenes (expanding storyboard)...', totalSeconds);
    const expanded = await expandPromptToScenes(prompt, style, cameraMotion);
    sceneDescriptions = expanded;
    const baseSeed = Date.now();

    // Fetch Scene 1 (must succeed via Pollinations with up to 3 retries)
    onProgress(12, 'Generating AI Scene 1 of 3...', totalSeconds);
    const scene1 = await fetchPollinationsImageWithRetries(
      expanded[0],
      aspectRatio,
      style,
      baseSeed,
      (msg) => onProgress(12, msg, totalSeconds)
    );
    sceneImages.push(scene1);

    // Attempt Scene 2 & Scene 3 cleanly; if Pollinations rate-limits mid-sequence, reuse Scene 1 with distinct framing
    for (let idx = 1; idx < 3; idx += 1) {
      const pct = 18 + idx * 8;
      onProgress(pct, `Generating AI Scene ${idx + 1} of 3...`, totalSeconds);
      try {
        const nextScene = await fetchPollinationsImageWithRetries(
          expanded[idx],
          aspectRatio,
          style,
          baseSeed + idx * 149,
          (msg) => onProgress(pct, msg, totalSeconds)
        );
        sceneImages.push(nextScene);
      } catch {
        // Keep using real AI Scene 1 image rather than ever rendering fake hills
        sceneImages.push(scene1);
      }
    }
  } else {
    onProgress(10, 'Generating AI Scene...', totalSeconds);
    const mainScene = await fetchPollinationsImageWithRetries(
      prompt,
      aspectRatio,
      style,
      Date.now(),
      (msg) => onProgress(12, msg, totalSeconds)
    );
    sceneImages.push(mainScene);
  }

  const startPercent = isMultiScene15s ? 35 : 22;
  onProgress(startPercent, `Rendering: ${totalSeconds}s remaining...`, totalSeconds);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas 2D context is unavailable.');
  }

  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support MediaRecorder video encoding.');
  }

  // Keep fps at 24 for ultra-smooth 3GB RAM mobile performance
  const fps = 24;
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
      // Proceed cleanly with video-only if audio decode fails
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
    }
  }

  // Trigger optional AI Voiceover via Web Speech API
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
  const bitrate = quality === '4k' ? 14_000_000 : quality === '1080p' ? 7_500_000 : 3_800_000;

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

  // Lightweight particle count (28) for smooth 3GB RAM playback
  const particles = Array.from({ length: 28 }, (_, idx) => ({
    x: ((idx * 197) % 1000) / 1000,
    y: ((idx * 353) % 1000) / 1000,
    radius: idx % 6 === 0 ? 3.8 : 1.4 + (idx % 3) * 0.7,
    speedX: ((idx % 5) - 2) * 0.0045,
    speedY: -0.007 - (idx % 3) * 0.0035,
    alpha: idx % 6 === 0 ? 0.1 : 0.18,
  }));

  const sceneMotions: [CameraMotionId, CameraMotionId, CameraMotionId] = [
    cameraMotion === 'static' ? 'dolly-push' : cameraMotion,
    cameraMotion === 'slow-pan' ? 'dolly-push' : 'slow-pan',
    cameraMotion === 'aerial-orbit' ? 'crane-up' : 'aerial-orbit',
  ];

  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const cleanMime = mimeType.split(';')[0];
      resolve(new Blob(chunks, { type: cleanMime }));
    };
    recorder.onerror = () => reject(new Error('Video recording failed.'));
  });

  recorder.start(250);

  const startTime = performance.now();
  const totalMs = totalSeconds * 1000;
  const crossfadeSec = 0.6;

  try {
    await new Promise<void>((resolve) => {
      const drawFrame = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / totalMs);
        const currentSec = t * totalSeconds;

        ctx.fillStyle = '#07090E';
        ctx.fillRect(0, 0, width, height);

        if (isMultiScene15s && sceneImages.length >= 3) {
          const segDur = 5;
          const sceneIdx = Math.min(2, Math.floor(currentSec / segDur));
          const sceneElapsed = currentSec - sceneIdx * segDur;
          const localT = Math.min(1, sceneElapsed / segDur);

          // If reusing Scene 1 fallback for act 2/3 due to rate limit, apply distinct zoom/pan bias
          const reused = sceneIdx > 0 && sceneImages[sceneIdx] === sceneImages[0];
          const biasX = reused ? (sceneIdx === 1 ? -0.035 : 0.035) : 0;
          const zoomBoost = reused ? (sceneIdx === 1 ? 1.08 : 1.04) : 1;

          drawKenBurnsImage(
            ctx,
            sceneImages[sceneIdx],
            width,
            height,
            localT,
            sceneMotions[sceneIdx],
            1,
            biasX,
            zoomBoost
          );

          if (sceneIdx < 2 && sceneElapsed > segDur - crossfadeSec) {
            const fadeT = (sceneElapsed - (segDur - crossfadeSec)) / crossfadeSec;
            const nextReused = sceneImages[sceneIdx + 1] === sceneImages[0];
            drawKenBurnsImage(
              ctx,
              sceneImages[sceneIdx + 1],
              width,
              height,
              0,
              sceneMotions[sceneIdx + 1],
              Math.min(1, Math.max(0, fadeT)),
              nextReused ? (sceneIdx + 1 === 1 ? -0.035 : 0.035) : 0,
              nextReused ? 1.08 : 1
            );
          }
        } else {
          drawKenBurnsImage(ctx, sceneImages[0], width, height, t, cameraMotion, 1);
        }

        // Dynamic neon lighting glow sweep
        const glowPulse = 0.055 + Math.sin(t * Math.PI * 2) * 0.025;
        const sweepX = (t * 1.35 - 0.18) * width;
        const beam = ctx.createLinearGradient(
          sweepX - width * 0.25,
          0,
          sweepX + width * 0.25,
          height
        );
        beam.addColorStop(0, 'rgba(255, 255, 255, 0)');
        beam.addColorStop(0.5, `rgba(34, 211, 238, ${glowPulse.toFixed(3)})`);
        beam.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beam;
        ctx.fillRect(0, 0, width, height);

        // Neon atmospheric particles
        for (const p of particles) {
          const px = (((p.x + t * p.speedX * 12) % 1) + 1) % 1 * width;
          const py = (((p.y + t * p.speedY * 12) % 1) + 1) % 1 * height;
          ctx.beginPath();
          ctx.arc(px, py, p.radius * (width / 1280), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(165, 243, 252, ${p.alpha})`;
          ctx.fill();
        }

        // Clean cinema vignette
        const vignette = ctx.createRadialGradient(
          width / 2,
          height / 2,
          width * 0.28,
          width / 2,
          height / 2,
          width * 0.78
        );
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(4,6,11,0.32)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);

        if (onFrameCanvas) {
          onFrameCanvas(canvas);
        }

        const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        const percentRange = 97 - startPercent;
        const percent = Math.min(97, Math.round(startPercent + t * percentRange));

        onProgress(
          percent,
          `Rendering ${totalSeconds}s Video · ${remainingSec}s remaining...`,
          remainingSec
        );

        if (elapsed < totalMs) {
          setTimeout(() => requestAnimationFrame(drawFrame), 1000 / fps);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(drawFrame);
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
