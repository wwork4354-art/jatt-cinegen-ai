import { STYLE_PROMPT_SUFFIX, type AspectRatio, type StylePresetId } from '../types/studio';
import { generateProceduralSceneImage } from './proceduralSceneCanvas';

export interface FetchedAiImageResult {
  img: HTMLImageElement;
  blob: Blob;
  objectUrl: string;
  providerLabel: string;
  width: number;
  height: number;
}

export function sanitizeSafePrompt(rawPrompt: string): string {
  const collapsed = rawPrompt
    .replace(/["'`<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= 280) return collapsed;
  return collapsed.slice(0, 280).trim();
}

export function getWaterfallDimensions(aspectRatio: AspectRatio): {
  fetchWidth: number;
  fetchHeight: number;
} {
  // Keep 1:1 at 768x768 (not 1024x1024) so Pollinations' 1024x1024 error banners are always caught.
  if (aspectRatio === '9:16') {
    return { fetchWidth: 576, fetchHeight: 1024 };
  }
  if (aspectRatio === '1:1') {
    return { fetchWidth: 768, fetchHeight: 768 };
  }
  return { fetchWidth: 1024, fetchHeight: 576 };
}

function loadImageFromObjectUrl(url: string, timeoutMs = 15000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      reject(new Error('Image decoding timed out'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Failed to decode fetched image'));
    };
    img.src = url;
  });
}

function loadImageDirectCrossOrigin(url: string, timeoutMs = 18000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => {
      reject(new Error('Direct image request timed out'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Direct image request failed'));
    };
    img.src = url;
  });
}

function isRateLimitOrRefusedBanner(
  img: HTMLImageElement,
  expectedWidth: number,
  expectedHeight: number,
  strictDimensionCheck: boolean
): string | null {
  if (img.naturalWidth < 200 || img.naturalHeight < 200) {
    return 'Image dimensions too small';
  }

  // Known Pollinations "Free limit reached" / "Image refused" square banner signature
  if (img.naturalWidth === 1024 && img.naturalHeight === 1024) {
    return 'Detected 1024x1024 error/refusal placeholder image';
  }

  if (strictDimensionCheck) {
    const targetRatio = expectedWidth / expectedHeight;
    const actualRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
    if (Math.abs(targetRatio - actualRatio) > 0.35) {
      return `Aspect mismatch (${img.naturalWidth}x${img.naturalHeight} instead of ${expectedWidth}x${expectedHeight})`;
    }
  }

  // Smart OCR-free visual card detection: flat solid-color background + monochrome centered text
  try {
    const size = 64;
    const probe = document.createElement('canvas');
    probe.width = size;
    probe.height = size;
    const pctx = probe.getContext('2d');
    if (!pctx) return null;
    pctx.drawImage(img, 0, 0, size, size);
    const data = pctx.getImageData(0, 0, size, size).data;

    const bgR = data[0];
    const bgG = data[1];
    const bgB = data[2];
    const totalPixels = size * size;
    let uniformBgPixels = 0;
    let monochromePixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) < 20) {
        uniformBgPixels += 1;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC < 18) {
        monochromePixels += 1;
      }
    }

    const bgRatio = uniformBgPixels / totalPixels;
    const monoRatio = monochromePixels / totalPixels;
    if (bgRatio > 0.68 || (bgRatio > 0.52 && monoRatio > 0.85)) {
      return 'Detected solid-background text/error banner';
    }
  } catch {
    // Ignore canvas read errors if image came without CORS pixel access
  }

  return null;
}

async function fetchAndValidateImageUrl(
  url: string,
  expectedWidth: number,
  expectedHeight: number,
  strictDimensionCheck: boolean,
  providerLabel: string,
  timeoutMs = 20000
): Promise<{ result: FetchedAiImageResult; retryAfterSec?: number }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch (err) {
    window.clearTimeout(timer);
    // If browser CORS blocks fetch on a backup endpoint, fall back to direct CORS <img> probe
    const directImg = await loadImageDirectCrossOrigin(url, timeoutMs);
    const reason = isRateLimitOrRefusedBanner(
      directImg,
      expectedWidth,
      expectedHeight,
      strictDimensionCheck
    );
    if (reason) {
      throw new Error(`${providerLabel}: ${reason}`);
    }
    const c = document.createElement('canvas');
    c.width = directImg.naturalWidth;
    c.height = directImg.naturalHeight;
    const ctx = c.getContext('2d');
    ctx?.drawImage(directImg, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob export failed'))), 'image/jpeg', 0.92)
    );
    const objectUrl = URL.createObjectURL(blob);
    return {
      result: {
        img: directImg,
        blob,
        objectUrl,
        providerLabel,
        width: directImg.naturalWidth,
        height: directImg.naturalHeight,
      },
    };
  }
  window.clearTimeout(timer);

  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  if (
    response.status === 402 ||
    response.status === 410 ||
    response.status === 429 ||
    response.status >= 500 ||
    !response.ok
  ) {
    const err = new Error(`${providerLabel} returned HTTP ${response.status}`) as Error & {
      retryAfterSec?: number;
    };
    err.retryAfterSec = Number.isFinite(retryAfterSec) ? retryAfterSec : undefined;
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`${providerLabel} returned non-image response (${contentType || 'unknown'})`);
  }

  const blob = await response.blob();
  if (blob.size < 6000) {
    throw new Error(`${providerLabel} returned an unexpectedly small payload (${blob.size} bytes)`);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromObjectUrl(objectUrl, 12000);
    const bannerReason = isRateLimitOrRefusedBanner(
      img,
      expectedWidth,
      expectedHeight,
      strictDimensionCheck
    );
    if (bannerReason) {
      throw new Error(`${providerLabel}: ${bannerReason}`);
    }
    return {
      result: {
        img,
        blob,
        objectUrl,
        providerLabel,
        width: img.naturalWidth,
        height: img.naturalHeight,
      },
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function fetchFromAiHordeFallback(
  cleanPrompt: string,
  fetchWidth: number,
  fetchHeight: number,
  onStatus?: (msg: string) => void
): Promise<FetchedAiImageResult> {
  // AI Horde requires width & height to be multiples of 64
  const hordeW = Math.max(512, Math.round(fetchWidth / 64) * 64);
  const hordeH = Math.max(512, Math.round(fetchHeight / 64) * 64);

  onStatus?.('Switching to Backup Free AI Cluster (AI Horde)...');
  const submitRes = await fetch('https://aihorde.net/api/v2/generate/async', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: '0000000000',
      'Client-Agent': 'JattCineGenAI:1.0:free',
    },
    body: JSON.stringify({
      prompt: cleanPrompt,
      params: {
        width: hordeW,
        height: hordeH,
        steps: 20,
        n: 1,
        sampler_name: 'k_euler_a',
      },
      nsfw: false,
      censor_nsfw: true,
      r2: true,
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`AI Horde submit failed (HTTP ${submitRes.status})`);
  }

  const submitData = (await submitRes.json()) as { id?: string };
  if (!submitData.id) {
    throw new Error('AI Horde did not return a job ID');
  }

  const deadline = Date.now() + 26000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const checkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${submitData.id}`);
    if (!checkRes.ok) continue;
    const checkData = (await checkRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      wait_time?: number;
    };
    if (checkData.faulted) {
      throw new Error('AI Horde generation faulted');
    }
    if (checkData.wait_time && checkData.wait_time > 0) {
      onStatus?.(`Backup Free AI Cluster rendering (~${Math.min(25, checkData.wait_time)}s)...`);
    }
    if (checkData.done) {
      const statusRes = await fetch(`https://aihorde.net/api/v2/generate/status/${submitData.id}`);
      if (!statusRes.ok) {
        throw new Error(`AI Horde status failed (HTTP ${statusRes.status})`);
      }
      const statusData = (await statusRes.json()) as {
        generations?: Array<{ img?: string }>;
      };
      const imgUrl = statusData.generations?.[0]?.img;
      if (!imgUrl) {
        throw new Error('AI Horde returned no image URL');
      }
      const fetched = await fetchAndValidateImageUrl(
        imgUrl,
        hordeW,
        hordeH,
        false,
        'AI Horde Free Cluster',
        20000
      );
      return fetched.result;
    }
  }

  throw new Error('AI Horde generation timed out');
}

export async function fetchFreeAiImageWithWaterfall(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  seed?: number;
  onStatus?: (msg: string) => void;
}): Promise<FetchedAiImageResult> {
  const { prompt, aspectRatio, style, onStatus } = params;
  const randomSeed = params.seed ?? Math.floor(100000 + Math.random() * 8999999);
  const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);

  const styleSuffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const cleanPrompt = sanitizeSafePrompt(
    styleSuffix ? `${prompt}, ${styleSuffix}` : prompt
  );
  const encodedPrompt = encodeURIComponent(cleanPrompt);

  const primaryFluxUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&seed=${randomSeed}`;
  const backupTurboUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=turbo&width=${fetchWidth}&height=${fetchHeight}&nologo=true&seed=${randomSeed + 99}`;
  const backupAirforceUrl = `https://api.airforce/imagine2?model=flux&prompt=${encodedPrompt}`;

  const providers: Array<{
    label: string;
    url: string;
    strictDimensionCheck: boolean;
  }> = [
    { label: 'Pollinations Flux', url: primaryFluxUrl, strictDimensionCheck: true },
    { label: 'Pollinations Turbo', url: backupTurboUrl, strictDimensionCheck: true },
    { label: 'Airforce Flux Backup', url: backupAirforceUrl, strictDimensionCheck: false },
  ];

  let suggestedWaitSec = 0;

  for (const provider of providers) {
    try {
      onStatus?.(`Generating AI visual via ${provider.label}...`);
      const { result } = await fetchAndValidateImageUrl(
        provider.url,
        fetchWidth,
        fetchHeight,
        provider.strictDimensionCheck,
        provider.label,
        18000
      );
      return result;
    } catch (err) {
      const retrySec = (err as { retryAfterSec?: number }).retryAfterSec;
      if (retrySec && retrySec > suggestedWaitSec) {
        suggestedWaitSec = retrySec;
      }
      onStatus?.(`${provider.label} unavailable — switching to backup provider...`);
    }
  }

  // Backup 3: Free keyless AI Horde distributed cluster
  try {
    return await fetchFromAiHordeFallback(cleanPrompt, fetchWidth, fetchHeight, onStatus);
  } catch {
    // If AI Horde also timed out and Pollinations suggested a brief retry window, wait & retry with randomized seed
    if (suggestedWaitSec > 0 && suggestedWaitSec <= 20) {
      const waitMs = Math.min(18000, (suggestedWaitSec + 1) * 1000);
      onStatus?.(`Cooling down ${Math.ceil(waitMs / 1000)}s and retrying with fresh seed...`);
      await new Promise((r) => setTimeout(r, waitMs));
      const retrySeed = Math.floor(100000 + Math.random() * 8999999);
      const retryUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&seed=${retrySeed}`;
      const { result } = await fetchAndValidateImageUrl(
        retryUrl,
        fetchWidth,
        fetchHeight,
        true,
        'Pollinations Flux (Retry)',
        20000
      );
      return result;
    }
  }

  throw new Error(
    'Free AI image providers are temporarily busy. Please wait a few seconds and click Generate again.'
  );
}

export function getFastVideoDimensions(aspectRatio: AspectRatio): {
  fetchWidth: number;
  fetchHeight: number;
} {
  if (aspectRatio === '9:16') {
    return { fetchWidth: 432, fetchHeight: 768 };
  }
  if (aspectRatio === '1:1') {
    return { fetchWidth: 512, fetchHeight: 512 };
  }
  return { fetchWidth: 768, fetchHeight: 432 };
}

export interface FastKeyframeResult {
  img: HTMLImageElement;
  objectUrl: string;
  isProcedural: boolean;
}

async function fetchSingleFastKeyframe(params: {
  scenePrompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  seed: number;
  sceneIndex: number;
}): Promise<FastKeyframeResult> {
  const { scenePrompt, aspectRatio, style, seed, sceneIndex } = params;
  const { fetchWidth, fetchHeight } = getFastVideoDimensions(aspectRatio);
  const styleSuffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const cleanPrompt = sanitizeSafePrompt(
    styleSuffix ? `${scenePrompt}, ${styleSuffix}` : scenePrompt
  );
  const encodedPrompt = encodeURIComponent(cleanPrompt);

  const deadline = Date.now() + 6000;

  const fastTurboUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&model=turbo&nologo=true&seed=${seed}`;
  const backupAirforceUrl = `https://api.airforce/imagine2?model=flux&prompt=${encodedPrompt}`;

  const candidates = [
    { url: fastTurboUrl, label: 'Pollinations Turbo', strict: true },
    { url: backupAirforceUrl, label: 'Airforce Flux', strict: false },
  ];

  for (const candidate of candidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 900) break;

    try {
      const { result } = await fetchAndValidateImageUrl(
        candidate.url,
        fetchWidth,
        fetchHeight,
        candidate.strict,
        candidate.label,
        remainingMs
      );
      return {
        img: result.img,
        objectUrl: result.objectUrl,
        isProcedural: false,
      };
    } catch {
      // Immediately move to next backup or procedural fallback within 6s budget
    }
  }

  // Instant Procedural Cinematic Canvas Fallback (under 40ms, zero hanging)
  const proc = await generateProceduralSceneImage({
    prompt: scenePrompt,
    aspectRatio,
    style,
    sceneIndex,
  });
  return {
    img: proc.img,
    objectUrl: proc.objectUrl,
    isProcedural: true,
  };
}

export async function fetchFastVideoKeyframesParallel(params: {
  scenePrompts: [string, string];
  aspectRatio: AspectRatio;
  style: StylePresetId;
  onStatus?: (msg: string) => void;
}): Promise<[FastKeyframeResult, FastKeyframeResult]> {
  const { scenePrompts, aspectRatio, style, onStatus } = params;
  const baseSeed = Math.floor(100000 + Math.random() * 8999999);

  onStatus?.('Fetching 2 parallel keyframes (6s fast timeout)...');

  const [k1, k2] = await Promise.all([
    fetchSingleFastKeyframe({
      scenePrompt: scenePrompts[0],
      aspectRatio,
      style,
      seed: baseSeed,
      sceneIndex: 0,
    }),
    fetchSingleFastKeyframe({
      scenePrompt: scenePrompts[1],
      aspectRatio,
      style,
      seed: baseSeed + 99,
      sceneIndex: 1,
    }),
  ]);

  // If Keyframe 1 got a real AI image and Keyframe 2 fell back to procedural due to 45s IP limit,
  // share the real AI image for seamless photorealistic continuity.
  if (!k1.isProcedural && k2.isProcedural) {
    URL.revokeObjectURL(k2.objectUrl);
    return [k1, { img: k1.img, objectUrl: k1.objectUrl, isProcedural: false }];
  }
  if (k1.isProcedural && !k2.isProcedural) {
    URL.revokeObjectURL(k1.objectUrl);
    return [{ img: k2.img, objectUrl: k2.objectUrl, isProcedural: false }, k2];
  }

  return [k1, k2];
}
