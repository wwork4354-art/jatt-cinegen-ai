import {
  STYLE_PROMPT_SUFFIX,
  type AspectRatio,
  type CameraMotionId,
  type LifetimeCaptionStyle,
  type LifetimeKeyframeSource,
  type LifetimeParticleStyle,
  type LifetimeSoundtrackMood,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
} from '../types/studio';
import {
  getWaterfallDimensions,
  sanitizeSafePrompt,
} from './freeImageWaterfall';

export interface LifetimePromptPreset {
  id: string;
  title: string;
  category: string;
  prompt: string;
  caption: string;
  style: StylePresetId;
  particleStyle: LifetimeParticleStyle;
  soundtrackMood: LifetimeSoundtrackMood;
}

export const LIFETIME_PROMPT_PRESETS: LifetimePromptPreset[] = [
  {
    id: 'cyber-tokyo',
    title: 'Cyberpunk Tokyo Rain',
    category: 'Neon Street',
    prompt:
      'Rain-slicked futuristic Tokyo alley at midnight with glowing cyan and amber neon signs, wet asphalt reflections, volumetric mist, cinematic wide shot',
    caption: 'MIDNIGHT IN NEO TOKYO',
    style: 'cinematic',
    particleStyle: 'cyber-dust',
    soundtrackMood: 'cyber-pulse',
  },
  {
    id: 'royal-haveli',
    title: 'Royal Punjabi Haveli Sunset',
    category: 'Heritage Cinema',
    prompt:
      'Grand sandstone Punjabi heritage courtyard haveli at golden sunset, warm glowing brass lanterns, mustard fields horizon, drifting birds, dramatic rays',
    caption: 'GOLDEN HERITAGE',
    style: 'realistic',
    particleStyle: 'golden-embers',
    soundtrackMood: 'warm-horizon',
  },
  {
    id: 'himalayan-dawn',
    title: 'Himalayan Dawn Peaks',
    category: 'Nature Epic',
    prompt:
      'Snow-capped Himalayan mountain ridges emerging through golden sunrise clouds, crisp pine valley mist below, anamorphic lens flare, sweeping vista',
    caption: 'ABOVE THE CLOUDS',
    style: 'cinematic',
    particleStyle: 'starlight',
    soundtrackMood: 'ambient-pad',
  },
  {
    id: 'neon-hypercar',
    title: 'Midnight Drift Hypercar',
    category: 'Automotive',
    prompt:
      'Matte obsidian electric hypercar speeding along a coastal mountain bridge at twilight, cyan rim glow, trailing light streaks, dynamic low angle',
    caption: 'VELOCITY ZERO',
    style: '3d-render',
    particleStyle: 'cyber-dust',
    soundtrackMood: 'cyber-pulse',
  },
  {
    id: 'spirit-forest',
    title: 'Bioluminescent Spirit Forest',
    category: 'Anime Fantasy',
    prompt:
      'Ancient enchanted forest illuminated by floating emerald fireflies and glowing turquoise waterfall mist, dreamy anime theatrical lighting',
    caption: 'WHISPERS OF LIGHT',
    style: 'anime',
    particleStyle: 'starlight',
    soundtrackMood: 'ambient-pad',
  },
  {
    id: 'cosmos-nebula',
    title: 'Deep Space Nebula Odyssey',
    category: 'Sci-Fi Vista',
    prompt:
      'Towering cosmic pillars of sapphire and gold stardust inside a deep space nebula, distant binary sun halo, ultra-crisp 8k astronomical photography',
    caption: 'BEYOND THE HORIZON',
    style: '3d-render',
    particleStyle: 'starlight',
    soundtrackMood: 'warm-horizon',
  },
];

export interface LifetimeImageResult {
  img: HTMLImageElement;
  blob: Blob;
  objectUrl: string;
  providerLabel: string;
  width: number;
  height: number;
}

export interface LifetimeVideoResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  engineLabel: string;
  scenes?: string[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  phase: number;
  color: string;
}

function getTargetVideoDimensions(
  aspectRatio: AspectRatio,
  quality: VideoQuality
): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    return quality === '1080p' || quality === '4k'
      ? { width: 1080, height: 1920 }
      : { width: 720, height: 1280 };
  }
  if (aspectRatio === '1:1') {
    return quality === '1080p' || quality === '4k'
      ? { width: 1080, height: 1080 }
      : { width: 720, height: 720 };
  }
  return quality === '1080p' || quality === '4k'
    ? { width: 1920, height: 1080 }
    : { width: 1280, height: 720 };
}

function chooseBestVideoMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function hashPromptToPalette(prompt: string, style: StylePresetId): {
  bgTop: string;
  bgMid: string;
  bgBottom: string;
  glowA: string;
  glowB: string;
  accent: string;
} {
  let hash = 0;
  for (let i = 0; i < prompt.length; i += 1) {
    hash = (hash * 31 + prompt.charCodeAt(i)) >>> 0;
  }

  const lower = prompt.toLowerCase();
  if (/sunset|gold|haveli|fire|ember|desert|warm|sun/.test(lower)) {
    return {
      bgTop: '#160B18',
      bgMid: '#4C1D24',
      bgBottom: '#0B0910',
      glowA: '#F59E0B',
      glowB: '#FB7185',
      accent: '#FDE68A',
    };
  }
  if (/forest|emerald|jungle|waterfall|nature|mountain|peak/.test(lower)) {
    return {
      bgTop: '#061519',
      bgMid: '#0F3B3E',
      bgBottom: '#050A0E',
      glowA: '#10B981',
      glowB: '#22D3EE',
      accent: '#A7F3D0',
    };
  }
  if (style === 'anime' || /violet|cosmos|nebula|galaxy|space/.test(lower)) {
    return {
      bgTop: '#09091E',
      bgMid: '#2E1854',
      bgBottom: '#050711',
      glowA: '#818CF8',
      glowB: '#38BDF8',
      accent: '#E0E7FF',
    };
  }

  const hue = hash % 45;
  return {
    bgTop: `hsl(${215 + hue}, 45%, 8%)`,
    bgMid: `hsl(${192 + hue}, 55%, 18%)`,
    bgBottom: '#06090F',
    glowA: '#22D3EE',
    glowB: '#6366F1',
    accent: '#BAE6FD',
  };
}

function createProceduralCinemaKeyframe(
  prompt: string,
  style: StylePresetId,
  width: number,
  height: number,
  variantIndex: number
): Promise<{ img: HTMLImageElement; blob: Blob; objectUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('HTML5 2D canvas unavailable.'));
  }

  const palette = hashPromptToPalette(prompt, style);
  const shift = variantIndex * 0.14;

  const bgGrad = ctx.createLinearGradient(0, 0, width * 0.25, height);
  bgGrad.addColorStop(0, palette.bgTop);
  bgGrad.addColorStop(0.55, palette.bgMid);
  bgGrad.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Volumetric celestial / sun orbs
  const orbX = width * (0.28 + shift);
  const orbY = height * (0.34 + (variantIndex % 2) * 0.08);
  const orbRadius = Math.min(width, height) * 0.55;
  const orbGrad = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, orbRadius);
  orbGrad.addColorStop(0, `${palette.glowA}99`);
  orbGrad.addColorStop(0.42, `${palette.glowB}44`);
  orbGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orbGrad;
  ctx.fillRect(0, 0, width, height);

  // Diagonal volumetric light beams
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i += 1) {
    const beamX = width * (0.15 + i * 0.22 + shift * 0.4);
    const beamGrad = ctx.createLinearGradient(beamX, 0, beamX + width * 0.18, height);
    beamGrad.addColorStop(0, `${palette.accent}22`);
    beamGrad.addColorStop(0.6, `${palette.glowA}12`);
    beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(beamX, 0);
    ctx.lineTo(beamX + width * 0.12, 0);
    ctx.lineTo(beamX + width * 0.34, height);
    ctx.lineTo(beamX + width * 0.06, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Layered distant horizon silhouettes
  for (let layer = 0; layer < 3; layer += 1) {
    const baseY = height * (0.64 + layer * 0.1);
    const amp = height * (0.08 - layer * 0.015);
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += Math.max(16, Math.round(width / 32))) {
      const n =
        Math.sin((x / width) * Math.PI * (2.5 + layer) + variantIndex * 1.4 + layer) * amp +
        Math.cos((x / width) * Math.PI * (5.2 + layer) + variantIndex) * (amp * 0.38);
      ctx.lineTo(x, baseY + n);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle =
      layer === 0
        ? 'rgba(12, 18, 30, 0.55)'
        : layer === 1
        ? 'rgba(8, 12, 22, 0.78)'
        : 'rgba(4, 7, 13, 0.94)';
    ctx.fill();
  }

  // Subtle star/bokeh points
  for (let i = 0; i < 42; i += 1) {
    const px = ((i * 197 + variantIndex * 73) % 1000) / 1000 * width;
    const py = ((i * 313 + variantIndex * 41) % 620) / 1000 * height;
    const r = 1 + (i % 4) * 0.9;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? `${palette.accent}AA` : 'rgba(255,255,255,0.45)';
    ctx.fill();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to generate procedural canvas image.'));
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ img, blob, objectUrl });
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Failed to load procedural canvas image.'));
        };
        img.src = objectUrl;
      },
      'image/jpeg',
      0.92
    );
  });
}

function isPollinationsPlaceholderOrSmall(
  img: HTMLImageElement,
  expectedWidth: number,
  expectedHeight: number
): boolean {
  if (img.naturalWidth < 250 || img.naturalHeight < 250) return true;
  if (img.naturalWidth === 1024 && img.naturalHeight === 1024) return true;
  const targetRatio = expectedWidth / Math.max(1, expectedHeight);
  const actualRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  if (Math.abs(targetRatio - actualRatio) > 0.35) return true;
  return false;
}

async function loadPublicPollinationsKeylessImage(
  url: string,
  expectedWidth: number,
  expectedHeight: number,
  providerLabel: string,
  timeoutMs = 15000
): Promise<LifetimeImageResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    window.clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error('Non-image response');
    }
    const blob = await response.blob();
    if (blob.size < 6000) {
      throw new Error('Image payload too small');
    }
    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Decode failed'));
      el.src = objectUrl;
    });

    if (isPollinationsPlaceholderOrSmall(img, expectedWidth, expectedHeight)) {
      URL.revokeObjectURL(objectUrl);
      throw new Error('Placeholder banner detected');
    }

    return {
      img,
      blob,
      objectUrl,
      providerLabel,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } catch {
    window.clearTimeout(timer);
    // Fallback to direct crossOrigin <img> load if CORS fetch failed cleanly
    const directImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.referrerPolicy = 'no-referrer';
      const imgTimer = window.setTimeout(() => reject(new Error('Timeout')), Math.min(9000, timeoutMs));
      el.onload = () => {
        window.clearTimeout(imgTimer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(imgTimer);
        reject(new Error('Direct load failed'));
      };
      el.src = url;
    });

    if (isPollinationsPlaceholderOrSmall(directImg, expectedWidth, expectedHeight)) {
      throw new Error('Placeholder banner detected');
    }

    const c = document.createElement('canvas');
    c.width = directImg.naturalWidth;
    c.height = directImg.naturalHeight;
    c.getContext('2d')?.drawImage(directImg, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/jpeg', 0.92)
    );
    const objectUrl = URL.createObjectURL(blob);
    return {
      img: directImg,
      blob,
      objectUrl,
      providerLabel,
      width: directImg.naturalWidth,
      height: directImg.naturalHeight,
    };
  }
}

export async function generateLifetimeFreeImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  seed?: number;
  offlineProceduralOnly?: boolean;
  onStatus?: (msg: string) => void;
}): Promise<LifetimeImageResult> {
  const { prompt, aspectRatio, style, offlineProceduralOnly, onStatus } = params;
  const seed = params.seed ?? Math.floor(100000 + Math.random() * 8999999);
  const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);
  const styleSuffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const cleanPrompt = sanitizeSafePrompt(styleSuffix ? `${prompt}, ${styleSuffix}` : prompt);
  const encodedPrompt = encodeURIComponent(cleanPrompt);

  if (!offlineProceduralOnly) {
    const attempts = [
      {
        label: 'Keyless Pollinations Flux AI',
        url: `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&model=flux&seed=${seed}`,
      },
      {
        label: 'Keyless Pollinations Turbo AI',
        url: `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&model=turbo&seed=${seed + 111}`,
      },
      {
        label: 'Keyless Pollinations Flux (Retry Seed)',
        url: `https://image.pollinations.ai/prompt/${encodeURIComponent(
          sanitizeSafePrompt(prompt)
        )}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&model=flux&seed=${seed + 555}`,
      },
    ];

    for (const attempt of attempts) {
      try {
        onStatus?.(`Fetching keyless free AI artwork (${attempt.label})...`);
        return await loadPublicPollinationsKeylessImage(
          attempt.url,
          fetchWidth,
          fetchHeight,
          attempt.label,
          14000
        );
      } catch {
        onStatus?.(`${attempt.label} busy — auto-retrying next keyless endpoint...`);
      }
    }
  }

  onStatus?.('Generating 100% offline procedural cinema artwork on HTML5 Canvas...');
  const procedural = await createProceduralCinemaKeyframe(
    prompt,
    style,
    fetchWidth,
    fetchHeight,
    0
  );
  return {
    img: procedural.img,
    blob: procedural.blob,
    objectUrl: procedural.objectUrl,
    providerLabel: 'Jatt Lifetime Canvas Synth (100% Offline)',
    width: fetchWidth,
    height: fetchHeight,
  };
}

function buildParticles(
  style: LifetimeParticleStyle,
  width: number,
  height: number
): Particle[] {
  if (style === 'none') return [];
  const count = style === 'starlight' ? 75 : 55;
  const particles: Particle[] = [];

  for (let i = 0; i < count; i += 1) {
    const palette =
      style === 'golden-embers'
        ? ['#F59E0B', '#FBBF24', '#FB923C']
        : style === 'starlight'
        ? ['#E0F2FE', '#BAE6FD', '#C7D2FE']
        : ['#22D3EE', '#38BDF8', '#A5F3FC'];

    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx:
        style === 'golden-embers'
          ? (Math.random() - 0.5) * 0.8
          : (Math.random() - 0.5) * 0.55,
      vy:
        style === 'golden-embers'
          ? -(0.6 + Math.random() * 1.4)
          : style === 'starlight'
          ? (Math.random() - 0.5) * 0.25
          : -(0.2 + Math.random() * 0.65),
      radius:
        style === 'starlight'
          ? 1.2 + Math.random() * 2.4
          : 2.2 + Math.random() * 4.5,
      alpha: 0.25 + Math.random() * 0.65,
      phase: Math.random() * Math.PI * 2,
      color: palette[i % palette.length],
    });
  }
  return particles;
}

function renderParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  width: number,
  height: number,
  timeSec: number,
  style: LifetimeParticleStyle
) {
  if (style === 'none' || particles.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;

    if (p.y < -12) p.y = height + 12;
    if (p.y > height + 12) p.y = -12;
    if (p.x < -12) p.x = width + 12;
    if (p.x > width + 12) p.x = -12;

    const flicker = 0.65 + 0.35 * Math.sin(timeSec * 2.8 + p.phase);
    const alpha = Math.max(0.08, Math.min(0.95, p.alpha * flicker));

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3.2);
    grad.addColorStop(0, p.color);
    grad.addColorStop(0.35, `${p.color}88`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawKenBurnsFrame(
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

  let scale = 1.06;
  let panX = 0;
  let panY = 0;
  const dir = sceneIndex % 2 === 0 ? 1 : -1;

  switch (cameraMotion) {
    case 'dolly-push':
      scale = 1.03 + 0.16 * localT;
      panY = -canvasH * 0.012 * localT;
      break;
    case 'slow-pan':
      scale = 1.15;
      panX = dir * canvasW * 0.06 * (localT - 0.5);
      break;
    case 'aerial-orbit':
      scale = 1.14 + 0.04 * Math.sin(localT * Math.PI);
      panX = Math.sin(localT * Math.PI * 1.1) * canvasW * 0.035 * dir;
      panY = Math.cos(localT * Math.PI * 0.9) * canvasH * 0.025;
      break;
    case 'crane-up':
      scale = 1.15;
      panY = canvasH * 0.055 * (0.5 - localT);
      break;
    case 'handheld-drift':
      scale = 1.11;
      panX = Math.sin(localT * Math.PI * 3.2) * canvasW * 0.02;
      panY = Math.cos(localT * Math.PI * 2.6) * canvasH * 0.015;
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

function renderAnimatedCaption(
  ctx: CanvasRenderingContext2D,
  caption: string,
  captionStyle: LifetimeCaptionStyle,
  width: number,
  height: number,
  globalT: number
) {
  const text = caption.trim();
  if (!text || captionStyle === 'none') return;

  ctx.save();
  // Bottom cinema contrast scrim so captions are always legible
  const scrimH = height * 0.24;
  const scrim = ctx.createLinearGradient(0, height - scrimH, 0, height);
  scrim.addColorStop(0, 'rgba(0,0,0,0)');
  scrim.addColorStop(1, 'rgba(5,7,11,0.78)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, height - scrimH, width, scrimH);

  const fontSize = Math.max(22, Math.round(Math.min(width, height) * 0.046));
  ctx.font = `700 ${fontSize}px "Outfit", "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const baseY = height * 0.865;
  const enterAlpha = Math.min(1, globalT * 5);
  const exitAlpha = Math.min(1, (1 - globalT) * 6);
  const envelopeAlpha = Math.max(0, Math.min(enterAlpha, exitAlpha));

  if (captionStyle === 'typewriter') {
    const revealCount = Math.max(1, Math.min(text.length, Math.ceil(text.length * Math.min(1, globalT * 1.9))));
    const shown = text.slice(0, revealCount);
    const cursor = Math.floor(globalT * 16) % 2 === 0 && revealCount < text.length ? '_' : '';
    ctx.globalAlpha = envelopeAlpha;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`${shown}${cursor}`, width / 2, baseY, width * 0.86);
  } else if (captionStyle === 'neon-bar') {
    const slideOffset = (1 - Math.min(1, globalT * 4.5)) * 24;
    ctx.globalAlpha = envelopeAlpha;
    const measured = Math.min(width * 0.84, ctx.measureText(text).width + 48);
    const barW = measured * Math.min(1, globalT * 3.5);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.88)';
    ctx.fillRect((width - barW) / 2, baseY + fontSize * 0.72 + slideOffset, barW, 3);
    ctx.shadowColor = 'rgba(34, 211, 238, 0.45)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, width / 2, baseY + slideOffset, width * 0.86);
  } else {
    // cinema-fade
    const driftY = (1 - Math.min(1, globalT * 3.5)) * 14;
    ctx.globalAlpha = envelopeAlpha;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(text, width / 2, baseY + driftY, width * 0.86);
  }

  ctx.restore();
}

function startWebAudioSynthTrack(
  mood: LifetimeSoundtrackMood,
  totalSeconds: number
): {
  context: AudioContext;
  stream: MediaStream;
  stop: () => void;
} | null {
  if (mood === 'silent' || typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 1.2);
  master.gain.setValueAtTime(0.24, Math.max(ctx.currentTime + 1.2, ctx.currentTime + totalSeconds - 1.4));
  master.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + totalSeconds);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = mood === 'cyber-pulse' ? 1150 : mood === 'warm-horizon' ? 780 : 640;

  filter.connect(master);
  master.connect(dest);

  // Polyphonic chord pad frequencies
  const chord =
    mood === 'warm-horizon'
      ? [146.83, 220.0, 293.66, 369.99] // D major dreamy
      : mood === 'cyber-pulse'
      ? [110.0, 164.81, 220.0, 261.63] // A minor cinematic
      : [130.81, 196.0, 246.94, 329.63]; // Cmaj7 ambient

  const nodesToStop: OscillatorNode[] = [];

  chord.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    osc.type = mood === 'cyber-pulse' && idx === 0 ? 'sawtooth' : idx % 2 === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (idx - 1.5) * 6;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = idx === 0 ? 0.35 : 0.16;

    osc.connect(voiceGain);
    voiceGain.connect(filter);
    osc.start(ctx.currentTime);
    nodesToStop.push(osc);
  });

  // Gentle LFO filter sweep for organic cinematic breath
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = mood === 'cyber-pulse' ? 1.8 : 0.25;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = mood === 'cyber-pulse' ? 380 : 210;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start(ctx.currentTime);
  nodesToStop.push(lfo);

  return {
    context: ctx,
    stream: dest.stream,
    stop: () => {
      for (const node of nodesToStop) {
        try {
          node.stop();
        } catch {
          // Ignore already stopped oscillators
        }
      }
      ctx.close().catch(() => {});
    },
  };
}

export async function renderLifetimeFreeVideo(params: {
  prompt: string;
  captionText: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  duration: VideoDuration;
  quality: VideoQuality;
  cameraMotion: CameraMotionId;
  particleStyle: LifetimeParticleStyle;
  captionStyle: LifetimeCaptionStyle;
  soundtrackMood: LifetimeSoundtrackMood;
  keyframeSource: LifetimeKeyframeSource;
  onFrameCanvas?: (sourceCanvas: HTMLCanvasElement) => void;
  onProgress: (percent: number, statusMessage: string, remainingSeconds?: number) => void;
}): Promise<LifetimeVideoResult> {
  const {
    prompt,
    captionText,
    aspectRatio,
    style,
    duration,
    quality,
    cameraMotion,
    particleStyle,
    captionStyle,
    soundtrackMood,
    keyframeSource,
    onFrameCanvas,
    onProgress,
  } = params;

  const { width, height } = getTargetVideoDimensions(aspectRatio, quality);
  const totalSeconds = duration === '5s' ? 5 : duration === '10s' ? 10 : 15;
  const sceneCount = duration === '5s' ? 2 : 3;
  const cleanupUrls: string[] = [];

  const sceneVariants =
    sceneCount === 2
      ? [`Wide establishing view, ${prompt}`, `Dynamic cinematic angle, ${prompt}`]
      : [
          `Wide establishing view, ${prompt}`,
          `Dynamic motion perspective, ${prompt}`,
          `Dramatic golden rim finale, ${prompt}`,
        ];

  const keyframes: HTMLImageElement[] = [];
  let usedKeylessAiFrames = false;

  onProgress(10, 'Preparing 100% Free Client-Side Video & Motion Studio...');

  if (keyframeSource === 'ai-pollinations') {
    onProgress(18, 'Fetching keyless Pollinations AI keyframes (zero API keys)...');
    const baseSeed = Math.floor(100000 + Math.random() * 8999999);
    const settled = await Promise.allSettled(
      sceneVariants.map((scenePrompt, idx) =>
        generateLifetimeFreeImage({
          prompt: scenePrompt,
          aspectRatio,
          style,
          seed: baseSeed + idx * 173,
          offlineProceduralOnly: false,
        })
      )
    );

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        cleanupUrls.push(res.value.objectUrl);
        keyframes.push(res.value.img);
        if (!res.value.providerLabel.includes('Offline')) {
          usedKeylessAiFrames = true;
        }
      }
    }
  }

  // Ensure full scene count even if offline or some frames were skipped
  while (keyframes.length < sceneCount) {
    const idx = keyframes.length;
    onProgress(28, 'Synthesizing offline procedural cinema backdrop...');
    const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);
    const proc = await createProceduralCinemaKeyframe(prompt, style, fetchWidth, fetchHeight, idx);
    cleanupUrls.push(proc.objectUrl);
    keyframes.push(proc.img);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    for (const u of cleanupUrls) URL.revokeObjectURL(u);
    throw new Error('Browser 2D Canvas is unavailable.');
  }
  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    for (const u of cleanupUrls) URL.revokeObjectURL(u);
    throw new Error('Your browser does not support HTML5 Canvas MediaRecorder export.');
  }

  const fps = 24;
  const frameIntervalMs = Math.round(1000 / fps);
  const videoStream = canvas.captureStream(fps);
  const combinedTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  const synthTrack = startWebAudioSynthTrack(soundtrackMood, totalSeconds);
  if (synthTrack) {
    combinedTracks.push(...synthTrack.stream.getAudioTracks());
  }

  const finalStream = new MediaStream(combinedTracks);
  const hasAudio = combinedTracks.some((t) => t.kind === 'audio');
  const mimeType = chooseBestVideoMimeType(hasAudio);
  const bitrate = quality === '1080p' || quality === '4k' ? 5_800_000 : 3_200_000;

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
        reject(new Error('Client-side video recording produced an empty file.'));
        return;
      }
      resolve(blob);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder failed during client-side render.'));
  });

  const particles = buildParticles(particleStyle, width, height);
  const totalFrames = totalSeconds * fps;
  const startTime = performance.now();

  onProgress(40, 'Rendering Ken Burns motion, neon particles & Web Audio soundtrack...');
  recorder.start(250);

  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const globalT = frame / Math.max(1, totalFrames - 1);
      const timeSec = frame / fps;

      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, width, height);

      const sceneFloat = globalT * keyframes.length;
      const idx = Math.min(keyframes.length - 1, Math.floor(sceneFloat));
      const nextIdx = Math.min(keyframes.length - 1, idx + 1);
      const localT = sceneFloat - idx;
      const fadeWindow = 0.22;

      drawKenBurnsFrame(ctx, keyframes[idx], width, height, localT, cameraMotion, 1, idx);
      if (idx !== nextIdx && localT > 1 - fadeWindow) {
        const blend = (localT - (1 - fadeWindow)) / fadeWindow;
        drawKenBurnsFrame(
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

      // Film vignette
      const vig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.34,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.74
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      // Neon particle overlay
      renderParticles(ctx, particles, width, height, timeSec, particleStyle);

      // Animated caption / title overlay
      renderAnimatedCaption(ctx, captionText, captionStyle, width, height, globalT);

      onFrameCanvas?.(canvas);

      if (frame % 4 === 0 || frame === totalFrames - 1) {
        const pct = Math.min(96, 40 + Math.round(globalT * 56));
        const rem = Math.max(0, Math.ceil(totalSeconds * (1 - globalT)));
        onProgress(
          pct,
          'Encoding free HD video via HTML5 Canvas + MediaRecorder...',
          rem
        );
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
    synthTrack?.stop();
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
    engineLabel: usedKeylessAiFrames
      ? 'Jatt Lifetime Free Studio (Keyless AI + Canvas)'
      : 'Jatt Lifetime Free Studio (100% Offline Canvas)',
    scenes: sceneVariants,
  };
}
