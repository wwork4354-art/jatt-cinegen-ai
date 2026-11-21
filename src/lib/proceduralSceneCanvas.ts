import type { AspectRatio, StylePresetId } from '../types/studio';

interface ThemePalette {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  accentPrimary: string;
  accentSecondary: string;
  groundDark: string;
  glowColor: string;
}

function hashPrompt(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function getThemePalette(lowerPrompt: string, style: StylePresetId): ThemePalette {
  const isCyber = /cyber|neon|future|sci-fi|robot|synth|laser|blade|hologram/.test(lowerPrompt);
  const isSunset = /sunset|sunrise|golden|dusk|dawn|amber|fire|lava|desert|volcano/.test(lowerPrompt);
  const isOcean = /ocean|sea|water|beach|wave|underwater|ship|island|whale/.test(lowerPrompt);
  const isSpace = /space|galaxy|cosmos|nebula|planet|star|astronaut|moon|universe/.test(lowerPrompt);
  const isForest = /jungle|forest|tree|woods|nature|rainforest|wild|savanna/.test(lowerPrompt);

  if (isCyber && isSunset) {
    return {
      skyTop: '#0B0720',
      skyMid: '#3B0F54',
      skyHorizon: '#FF5E3A',
      accentPrimary: '#22D3EE',
      accentSecondary: '#F43F5E',
      groundDark: '#070612',
      glowColor: 'rgba(34, 211, 238, 0.55)',
    };
  }
  if (isCyber) {
    return {
      skyTop: '#050817',
      skyMid: '#131642',
      skyHorizon: '#2A1154',
      accentPrimary: '#00F0FF',
      accentSecondary: '#FF2A85',
      groundDark: '#050711',
      glowColor: 'rgba(0, 240, 255, 0.55)',
    };
  }
  if (isSpace) {
    return {
      skyTop: '#02040D',
      skyMid: '#111638',
      skyHorizon: '#311B6B',
      accentPrimary: '#60A5FA',
      accentSecondary: '#C084FC',
      groundDark: '#040610',
      glowColor: 'rgba(167, 139, 250, 0.5)',
    };
  }
  if (isOcean) {
    return {
      skyTop: '#061529',
      skyMid: '#0D3B59',
      skyHorizon: isSunset ? '#F59E0B' : '#14B8A6',
      accentPrimary: '#2DD4BF',
      accentSecondary: '#38BDF8',
      groundDark: '#03111F',
      glowColor: 'rgba(45, 212, 191, 0.45)',
    };
  }
  if (isSunset) {
    return {
      skyTop: '#160B24',
      skyMid: '#6E1E4A',
      skyHorizon: '#F97316',
      accentPrimary: '#FBBF24',
      accentSecondary: '#FB7185',
      groundDark: '#0B0612',
      glowColor: 'rgba(251, 191, 36, 0.5)',
    };
  }
  if (isForest) {
    return {
      skyTop: '#051412',
      skyMid: '#0E342D',
      skyHorizon: '#1F6F5B',
      accentPrimary: '#34D399',
      accentSecondary: '#22D3EE',
      groundDark: '#040D0B',
      glowColor: 'rgba(52, 211, 153, 0.45)',
    };
  }
  if (style === 'anime') {
    return {
      skyTop: '#0F1B4C',
      skyMid: '#2563EB',
      skyHorizon: '#F472B6',
      accentPrimary: '#38BDF8',
      accentSecondary: '#FBBF24',
      groundDark: '#0B1026',
      glowColor: 'rgba(56, 189, 248, 0.45)',
    };
  }

  return {
    skyTop: '#080D1B',
    skyMid: '#182848',
    skyHorizon: '#2C5364',
    accentPrimary: '#22D3EE',
    accentSecondary: '#F59E0B',
    groundDark: '#060911',
    glowColor: 'rgba(34, 211, 238, 0.45)',
  };
}

function drawLionSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rimColor: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Backlight aura
  const aura = ctx.createRadialGradient(20, -25, 10, 20, -25, 120);
  aura.addColorStop(0, rimColor);
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(20, -25, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#07090F';
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 2.5;

  // Body + striding legs
  ctx.beginPath();
  ctx.moveTo(-78, 5);
  ctx.quadraticCurveTo(-30, -22, 22, -16);
  ctx.quadraticCurveTo(45, -18, 54, -4);
  ctx.lineTo(52, 42);
  ctx.lineTo(38, 42);
  ctx.lineTo(35, 12);
  ctx.lineTo(14, 15);
  ctx.lineTo(24, 42);
  ctx.lineTo(10, 42);
  ctx.lineTo(-4, 14);
  ctx.lineTo(-46, 14);
  ctx.lineTo(-38, 42);
  ctx.lineTo(-52, 42);
  ctx.lineTo(-65, 16);
  ctx.lineTo(-76, 42);
  ctx.lineTo(-90, 42);
  ctx.lineTo(-78, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.moveTo(-76, 4);
  ctx.bezierCurveTo(-110, -8, -112, -36, -96, -42);
  ctx.stroke();

  // Majestic Mane
  ctx.beginPath();
  const maneCx = 48;
  const maneCy = -28;
  const spikes = 16;
  for (let i = 0; i <= spikes; i += 1) {
    const angle = (i / spikes) * Math.PI * 2;
    const rad = i % 2 === 0 ? 44 : 33;
    const px = maneCx + Math.cos(angle) * rad;
    const py = maneCy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Lion snout & head profile
  ctx.beginPath();
  ctx.moveTo(64, -36);
  ctx.lineTo(94, -28);
  ctx.lineTo(92, -16);
  ctx.lineTo(72, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Glowing eye highlight
  ctx.fillStyle = rimColor;
  ctx.beginPath();
  ctx.arc(73, -29, 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawDragonOrBirdSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rimColor: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#07090F';
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 2.2;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-40, -68, -120, -70, -155, -18);
  ctx.bezierCurveTo(-95, -26, -50, -10, -22, 12);
  ctx.lineTo(-55, 58);
  ctx.lineTo(-10, 26);
  ctx.lineTo(35, 10);
  ctx.bezierCurveTo(60, -28, 115, -52, 152, -26);
  ctx.bezierCurveTo(110, -60, 48, -56, 12, -8);
  ctx.lineTo(38, -32);
  ctx.lineTo(62, -28);
  ctx.lineTo(42, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawVehicleSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rimColor: string,
  secondary: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Light trails
  const trail = ctx.createLinearGradient(-260, 0, 120, 0);
  trail.addColorStop(0, 'rgba(0,0,0,0)');
  trail.addColorStop(0.7, secondary);
  trail.addColorStop(1, rimColor);
  ctx.strokeStyle = trail;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-250, 8);
  ctx.lineTo(-90, 8);
  ctx.moveTo(-230, 18);
  ctx.lineTo(-80, 18);
  ctx.stroke();

  ctx.fillStyle = '#07090F';
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-110, 22);
  ctx.lineTo(-98, -4);
  ctx.lineTo(-42, -28);
  ctx.lineTo(28, -28);
  ctx.lineTo(82, -2);
  ctx.lineTo(114, 12);
  ctx.lineTo(110, 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Wheels
  for (const wx of [-68, 66]) {
    ctx.beginPath();
    ctx.arc(wx, 24, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Headlight glow
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(106, 8, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawHeroSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  rimColor: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#07090F';
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 2.2;

  // Head & shoulders + flowing cloak
  ctx.beginPath();
  ctx.arc(0, -68, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-24, -46);
  ctx.lineTo(24, -46);
  ctx.lineTo(44, 52);
  ctx.lineTo(12, 52);
  ctx.lineTo(6, 12);
  ctx.lineTo(-6, 12);
  ctx.lineTo(-14, 52);
  ctx.lineTo(-56, 52);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

export async function generateProceduralSceneImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  sceneIndex: number;
}): Promise<{ img: HTMLImageElement; objectUrl: string; width: number; height: number }> {
  const { prompt, aspectRatio, style, sceneIndex } = params;
  const width = aspectRatio === '9:16' ? 432 : aspectRatio === '1:1' ? 512 : 768;
  const height = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 512 : 432;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D unavailable');
  }

  const lower = prompt.toLowerCase();
  const palette = getThemePalette(lower, style);
  const seed = hashPrompt(prompt + String(sceneIndex));
  const horizonY = height * (sceneIndex === 0 ? 0.63 : 0.58);

  // 1. Atmospheric multi-stop sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY + height * 0.14);
  skyGrad.addColorStop(0, palette.skyTop);
  skyGrad.addColorStop(0.58, palette.skyMid);
  skyGrad.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Stars / atmospheric dust
  for (let i = 0; i < 65; i += 1) {
    const sx = ((seed * (i + 7) * 193) % 1000) / 1000 * width;
    const sy = ((seed * (i + 13) * 317) % 1000) / 1000 * horizonY * 0.85;
    const r = (i % 4 === 0 ? 1.7 : 0.9) * (width / 768);
    ctx.fillStyle = i % 3 === 0 ? palette.accentPrimary : 'rgba(255,255,255,0.65)';
    ctx.globalAlpha = 0.25 + (i % 5) * 0.12;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 3. Celestial orb / Neon sun / Planet
  const sunX = width * (sceneIndex === 0 ? 0.66 : 0.48);
  const sunY = horizonY * (sceneIndex === 0 ? 0.72 : 0.64);
  const sunRadius = Math.min(width, height) * (sceneIndex === 0 ? 0.17 : 0.22);

  const halo = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.2, sunX, sunY, sunRadius * 2.6);
  halo.addColorStop(0, palette.accentSecondary);
  halo.addColorStop(0.45, palette.glowColor);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius * 2.6, 0, Math.PI * 2);
  ctx.fill();

  const orbGrad = ctx.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
  orbGrad.addColorStop(0, '#FFF7ED');
  orbGrad.addColorStop(0.5, palette.accentPrimary);
  orbGrad.addColorStop(1, palette.accentSecondary);
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fill();

  // 4. Environment mid-layers based on prompt keywords
  const isCity = /city|street|urban|building|tokyo|cyber|neon|tower|bridge|skyline/.test(lower);
  const isJungle = /jungle|forest|tree|woods|nature|wild|lion|tiger|panther/.test(lower);
  const isOcean = /ocean|sea|beach|wave|water|boat|ship/.test(lower);

  if (isCity) {
    const towerCount = 16;
    const bw = width / towerCount;
    for (let i = 0; i < towerCount; i += 1) {
      const th = height * (0.14 + (((seed + i * 71) % 28) / 100));
      const tx = i * bw;
      const ty = horizonY - th;
      ctx.fillStyle = i % 2 === 0 ? '#0B1021' : '#10172D';
      ctx.fillRect(tx, ty, bw - 2, th + 4);
      // Lit neon windows
      ctx.fillStyle = i % 3 === 0 ? palette.accentPrimary : palette.accentSecondary;
      ctx.globalAlpha = 0.45;
      for (let wy = ty + 8; wy < horizonY - 8; wy += 12) {
        if ((i + wy) % 2 === 0) {
          ctx.fillRect(tx + 4, wy, Math.max(4, bw * 0.35), 4);
        }
      }
      ctx.globalAlpha = 1;
    }
  } else {
    // Layered mountain / mist silhouettes
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.fillStyle = layer === 0 ? 'rgba(11, 16, 34, 0.72)' : '#090D1A';
      ctx.beginPath();
      ctx.moveTo(0, horizonY + 12);
      const steps = 10;
      for (let s = 0; s <= steps; s += 1) {
        const px = (s / steps) * width;
        const amp = (layer === 0 ? 0.14 : 0.08) * height;
        const py = horizonY - Math.abs(Math.sin(s * 0.8 + layer * 2.1 + (seed % 7))) * amp;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(width, horizonY + 18);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (isJungle) {
    // Glowing canopy pillars & jungle foliage framing
    ctx.fillStyle = '#050B0A';
    const trunkPositions = [0.06, 0.14, 0.86, 0.94];
    for (const pos of trunkPositions) {
      const tx = width * pos;
      ctx.fillRect(tx - 10, 0, 20, height);
      ctx.strokeStyle = palette.accentPrimary;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tx + (pos < 0.5 ? 10 : -10), 0);
      ctx.lineTo(tx + (pos < 0.5 ? 10 : -10), horizonY);
      ctx.stroke();
    }
  }

  // 5. Volumetric light shafts
  for (let b = 0; b < 3; b += 1) {
    const bx = sunX + (b - 1) * width * 0.14;
    const beam = ctx.createLinearGradient(sunX, sunY, bx, height);
    beam.addColorStop(0, palette.glowColor);
    beam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beam;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(sunX - 18, sunY);
    ctx.lineTo(sunX + 18, sunY);
    ctx.lineTo(bx + 110, height);
    ctx.lineTo(bx - 110, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 6. Foreground ground / reflective water / cyber grid
  const groundGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  groundGrad.addColorStop(0, isOcean ? palette.skyMid : palette.groundDark);
  groundGrad.addColorStop(1, '#04060B');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  if (isOcean || isCity) {
    // Shimmering reflections
    for (let r = 0; r < 14; r += 1) {
      const ry = horizonY + 8 + (r / 14) * (height - horizonY - 14);
      const rw = (sunRadius * 1.4) * (1 - r / 18);
      ctx.fillStyle = r % 2 === 0 ? palette.accentPrimary : palette.accentSecondary;
      ctx.globalAlpha = 0.25 * (1 - r / 16);
      ctx.fillRect(sunX - rw / 2 + Math.sin(r * 1.7) * 14, ry, rw, 2.5);
    }
    ctx.globalAlpha = 1;
  }

  if (/cyber|neon|future|synth/.test(lower) && !isOcean) {
    ctx.strokeStyle = palette.accentPrimary;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 1.2;
    for (let g = -6; g <= 6; g += 1) {
      ctx.beginPath();
      ctx.moveTo(width / 2 + g * 24, horizonY);
      ctx.lineTo(width / 2 + g * 120, height);
      ctx.stroke();
    }
    for (let h = 1; h <= 5; h += 1) {
      const gy = horizonY + Math.pow(h / 5, 1.5) * (height - horizonY);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 7. Prompt-Matched Hero Silhouette
  const subjectX = width * (sceneIndex === 0 ? 0.42 : 0.53);
  const subjectY = horizonY + height * 0.04;
  const heroScale = (Math.min(width, height) / 432) * (sceneIndex === 0 ? 1.15 : 1.38);

  if (/lion|tiger|panther|leopard|cheetah|cat/.test(lower)) {
    drawLionSilhouette(ctx, subjectX, subjectY, heroScale, palette.accentPrimary);
  } else if (/dragon|phoenix|eagle|bird|owl|hawk/.test(lower)) {
    drawDragonOrBirdSilhouette(ctx, subjectX, horizonY * 0.62, heroScale * 0.9, palette.accentSecondary);
  } else if (/car|supercar|bike|motorcycle|train|vehicle/.test(lower)) {
    drawVehicleSilhouette(ctx, subjectX, subjectY + 10, heroScale * 1.05, palette.accentPrimary, palette.accentSecondary);
  } else if (/person|man|woman|girl|boy|warrior|samurai|astronaut|hero|knight|king|queen/.test(lower)) {
    drawHeroSilhouette(ctx, subjectX, subjectY - 6, heroScale * 1.15, palette.accentPrimary);
  } else {
    // Dramatic glowing foreground silhouette crest
    ctx.fillStyle = '#06080F';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, horizonY + height * 0.14);
    ctx.quadraticCurveTo(width * 0.35, horizonY + height * 0.04, width * 0.72, horizonY + height * 0.17);
    ctx.lineTo(width, horizonY + height * 0.11);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }

  // Convert canvas to a clean Blob URL + Image
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Procedural canvas export failed'))),
      'image/jpeg',
      0.92
    );
  });
  const objectUrl = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load procedural scene'));
    el.src = objectUrl;
  });

  return { img, objectUrl, width, height };
}
