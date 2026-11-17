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
}

function getDimensions(aspectRatio: AspectRatio, quality: VideoQuality): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    return quality === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  if (aspectRatio === '1:1') {
    return quality === '1080p' ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  return quality === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function loadImageFromUrl(src: string, timeoutMs = 10000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => {
      reject(new Error('Image load timed out'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Failed to load base frame image'));
    };
    img.src = src;
  });
}

function isLikelyBannerOrLowDetail(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): boolean {
  if (img.naturalWidth < 360 || img.naturalHeight < 360) return true;
  const targetRatio = targetWidth / targetHeight;
  const actualRatio = img.naturalWidth / img.naturalHeight;
  if (Math.abs(targetRatio - actualRatio) > 0.32) {
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
    if (uniformPixels / totalPixels > 0.72) {
      return true;
    }
  } catch {
    // Ignore probe errors
  }

  return false;
}

async function fetchFastPollinationsKeyframe(
  prompt: string,
  aspectRatio: AspectRatio,
  style: StylePresetId,
  seed: number
): Promise<HTMLImageElement | null> {
  const { url, fetchWidth, fetchHeight } = buildPollinationsFastKeyframeUrl(
    prompt,
    aspectRatio,
    style,
    seed
  );

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    window.clearTimeout(timeoutId);

    const retryAfterHeader = res.headers.get('retry-after');
    const paymentRequired = res.headers.get('payment-required');
    if (!res.ok || res.status === 402 || res.status === 429 || paymentRequired || retryAfterHeader) {
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return null;
    }

    const blob = await res.blob();
    if (blob.size < 25000) {
      return null;
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImageFromUrl(objectUrl, 8000);
      if (isLikelyBannerOrLowDetail(img, fetchWidth, fetchHeight)) {
        URL.revokeObjectURL(objectUrl);
        return null;
      }
      return img;
    } catch {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
  } catch {
    window.clearTimeout(timeoutId);
    return null;
  }
}

function getStylePalette(style: StylePresetId, prompt: string): [string, string, string] {
  const lower = prompt.toLowerCase();
  if (lower.includes('savanna') || lower.includes('lion') || lower.includes('desert') || lower.includes('sunset')) {
    return ['#160B06', '#7C2D12', '#F59E0B'];
  }
  if (lower.includes('forest') || lower.includes('jungle') || lower.includes('emerald')) {
    return ['#04130D', '#065F46', '#34D399'];
  }
  switch (style) {
    case 'anime':
      return ['#0F172A', '#312E81', '#F59E0B'];
    case '3d-render':
      return ['#090D16', '#0E7490', '#22D3EE'];
    case 'cinematic':
      return ['#070A10', '#164E63', '#EA580C'];
    default:
      return ['#0A0F1A', '#1E293B', '#38BDF8'];
  }
}

function synthesizeFallbackSceneCanvas(
  width: number,
  height: number,
  style: StylePresetId,
  prompt: string
): HTMLCanvasElement {
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const octx = offscreen.getContext('2d');
  if (!octx) return offscreen;

  const [c1, c2, c3] = getStylePalette(style, prompt);

  const bg = octx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, c1);
  bg.addColorStop(0.54, c2);
  bg.addColorStop(1, c3);
  octx.fillStyle = bg;
  octx.fillRect(0, 0, width, height);

  const sunX = width * 0.62;
  const sunY = height * 0.38;
  const glow = octx.createRadialGradient(sunX, sunY, 20, sunX, sunY, width * 0.56);
  glow.addColorStop(0, 'rgba(254, 240, 138, 0.45)');
  glow.addColorStop(0.42, 'rgba(34, 211, 238, 0.18)');
  glow.addColorStop(1, 'rgba(7, 9, 14, 0)');
  octx.fillStyle = glow;
  octx.fillRect(0, 0, width, height);

  for (let layer = 0; layer < 3; layer += 1) {
    octx.beginPath();
    const baseY = height * (0.58 + layer * 0.11);
    octx.moveTo(0, height);
    octx.lineTo(0, baseY);
    for (let x = 0; x <= width; x += width / 18) {
      const wave =
        Math.sin((x / width) * Math.PI * (2.4 + layer) + layer * 1.1) *
        (height * (0.055 - layer * 0.01));
      octx.lineTo(x, baseY + wave);
    }
    octx.lineTo(width, height);
    octx.closePath();
    octx.fillStyle =
      layer === 0
        ? 'rgba(15, 23, 42, 0.52)'
        : layer === 1
        ? 'rgba(9, 13, 24, 0.78)'
        : 'rgba(5, 7, 13, 0.94)';
    octx.fill();
  }

  return offscreen;
}

function chooseSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function drawDynamicSceneFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
  t: number,
  motion: CameraMotionId
) {
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  // Base Ken Burns motion + organic micro camera shake
  let scale = 1.07;
  let offsetX = 0;
  let offsetY = 0;
  let rotation = 0;

  switch (motion) {
    case 'dolly-push':
      scale = 1.03 + ease * 0.17;
      offsetX = Math.sin(t * Math.PI) * width * 0.018;
      break;
    case 'slow-pan':
      scale = 1.16;
      offsetX = (0.5 - ease) * width * 0.12;
      break;
    case 'aerial-orbit':
      scale = 1.16;
      offsetX = Math.sin(t * Math.PI * 2) * width * 0.045;
      offsetY = Math.cos(t * Math.PI * 2) * height * 0.03;
      rotation = Math.sin(t * Math.PI * 2) * 0.015;
      break;
    case 'crane-up':
      scale = 1.16;
      offsetY = (0.5 - ease) * height * 0.11;
      break;
    case 'handheld-drift':
      scale = 1.12;
      offsetX = Math.sin(t * 10.5) * width * 0.014 + Math.cos(t * 4.7) * width * 0.009;
      offsetY = Math.cos(t * 8.4) * height * 0.012;
      rotation = Math.sin(t * 7.2) * 0.008;
      break;
    case 'static':
    default:
      scale = 1.04 + Math.sin(t * Math.PI) * 0.03;
      break;
  }

  // Subtle organic cinema camera shake layered onto all active motion modes
  if (motion !== 'static') {
    offsetX += Math.sin(t * 24) * width * 0.0022 + Math.cos(t * 14) * width * 0.0015;
    offsetY += Math.cos(t * 21) * height * 0.0022;
    rotation += Math.sin(t * 18) * 0.0014;
  }

  const srcWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  const imgAspect = srcWidth / Math.max(1, srcHeight);
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
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
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
  onFrameCanvas,
  onProgress,
}: RenderDemoVideoParams): Promise<RenderedVideoResult> {
  const { width, height } = getDimensions(aspectRatio, quality);
  const totalSeconds = duration === '15s' ? 15 : duration === '10s' ? 10 : 5;

  let mainScene: HTMLImageElement | HTMLCanvasElement;

  if (sourceImageDataUrl) {
    onProgress(8, 'Preparing uploaded image...', totalSeconds);
    try {
      mainScene = await loadImageFromUrl(sourceImageDataUrl, 12000);
    } catch {
      mainScene = synthesizeFallbackSceneCanvas(width, height, style, prompt);
    }
  } else {
    onProgress(8, 'Fetching fast 720p HD scene image...', totalSeconds);
    const fetched = await fetchFastPollinationsKeyframe(
      prompt,
      aspectRatio,
      style,
      Date.now()
    );
    mainScene = fetched ?? synthesizeFallbackSceneCanvas(width, height, style, prompt);
  }

  onProgress(
    15,
    `Rendering: ${totalSeconds}s remaining...`,
    totalSeconds
  );

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

  const fps = 30;
  const stream = canvas.captureStream(fps);
  const mimeType = chooseSupportedMimeType();
  const bitrate = quality === '1080p' ? 8_000_000 : 4_200_000;

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const particles = Array.from({ length: 44 }, (_, idx) => ({
    x: ((idx * 197) % 1000) / 1000,
    y: ((idx * 353) % 1000) / 1000,
    radius: idx % 7 === 0 ? 4.2 + (idx % 3) * 2.0 : 1.3 + (idx % 4) * 0.85,
    speedX: ((idx % 5) - 2) * (idx % 7 === 0 ? 0.01 : 0.0045),
    speedY: -0.007 - (idx % 3) * 0.004,
    alpha: idx % 7 === 0 ? 0.09 : 0.16 + (idx % 5) * 0.05,
  }));

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

  await new Promise<void>((resolve) => {
    const drawFrame = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / totalMs);

      ctx.fillStyle = '#07090E';
      ctx.fillRect(0, 0, width, height);

      drawDynamicSceneFrame(ctx, mainScene, width, height, t, cameraMotion);

      // Pulsing dynamic atmospheric lighting glow
      const glowPulse = 0.06 + Math.sin(t * Math.PI * 2) * 0.03;
      const sweepX = (t * 1.35 - 0.18) * width;
      const beam = ctx.createLinearGradient(
        sweepX - width * 0.25,
        0,
        sweepX + width * 0.25,
        height
      );
      beam.addColorStop(0, 'rgba(255, 255, 255, 0)');
      beam.addColorStop(0.5, `rgba(224, 242, 254, ${glowPulse.toFixed(3)})`);
      beam.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height);

      // Parallax atmospheric dust & bokeh
      for (const p of particles) {
        const px = (((p.x + t * p.speedX * 12) % 1) + 1) % 1 * width;
        const py = (((p.y + t * p.speedY * 12) % 1) + 1) % 1 * height;
        ctx.beginPath();
        ctx.arc(px, py, p.radius * (width / 1280), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 242, 254, ${p.alpha})`;
        ctx.fill();
      }

      // Clean optical cinema vignette (zero watermark)
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        width * 0.28,
        width / 2,
        height / 2,
        width * 0.78
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(4,6,11,0.34)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      // Push frame straight to the live real-time preview canvas
      if (onFrameCanvas) {
        onFrameCanvas(canvas);
      }

      const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      const percent = Math.min(97, Math.round(15 + t * 82));

      onProgress(
        percent,
        `Rendering: ${remainingSec}s remaining...`,
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
  };
}
