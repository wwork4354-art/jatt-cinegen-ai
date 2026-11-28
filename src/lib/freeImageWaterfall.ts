import { STYLE_PROMPT_SUFFIX, type AspectRatio, type StylePresetId } from '../types/studio';
import { getCuratedHdPhotoUrls, searchWikimediaCommonsPhotos } from './realPhotoFallback';

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

function loadImageDirectCrossOrigin(url: string, timeoutMs = 15000): Promise<HTMLImageElement> {
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
  if (img.naturalWidth < 250 || img.naturalHeight < 250) {
    return 'Image dimensions too small';
  }

  // Known Pollinations "Free limit reached" / "Image refused" square banner signature
  if (strictDimensionCheck && img.naturalWidth === 1024 && img.naturalHeight === 1024) {
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

      if (Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) < 18) {
        uniformBgPixels += 1;
      }

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC < 16) {
        monochromePixels += 1;
      }
    }

    const bgRatio = uniformBgPixels / totalPixels;
    const monoRatio = monochromePixels / totalPixels;
    if (bgRatio > 0.68 || (bgRatio > 0.52 && monoRatio > 0.85)) {
      return 'Detected solid-background text/error banner';
    }
  } catch {
    // Ignore canvas read errors if image came without pixel access
  }

  return null;
}

async function fetchAndValidateImageUrl(
  url: string,
  expectedWidth: number,
  expectedHeight: number,
  strictDimensionCheck: boolean,
  providerLabel: string,
  timeoutMs = 15000
): Promise<FetchedAiImageResult> {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

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
    if (didTimeout) {
      throw new Error(`${providerLabel}: request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const directImg = await loadImageDirectCrossOrigin(url, Math.min(8000, timeoutMs));
    void err;
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
      img: directImg,
      blob,
      objectUrl,
      providerLabel,
      width: directImg.naturalWidth,
      height: directImg.naturalHeight,
    };
  }
  window.clearTimeout(timer);

  if (
    response.status === 402 ||
    response.status === 410 ||
    response.status === 429 ||
    response.status >= 500 ||
    !response.ok
  ) {
    throw new Error(`${providerLabel} returned HTTP ${response.status}`);
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
      img,
      blob,
      objectUrl,
      providerLabel,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function fetchRealPhotoFallbackList(
  prompt: string,
  aspectRatio: AspectRatio,
  count: number,
  onStatus?: (msg: string) => void
): Promise<FetchedAiImageResult[]> {
  const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);
  const results: FetchedAiImageResult[] = [];

  onStatus?.('Searching real HD photography matching prompt keywords...');
  const wikiUrls = await searchWikimediaCommonsPhotos(prompt, 8);
  const curatedUrls = getCuratedHdPhotoUrls(prompt, aspectRatio);
  const candidatePool = [...wikiUrls, ...curatedUrls];

  for (const photoUrl of candidatePool) {
    if (results.length >= count) break;
    try {
      const label = photoUrl.includes('wikimedia.org')
        ? 'Wikimedia Commons HD Photo'
        : 'Curated HD Photo';
      const fetched = await fetchAndValidateImageUrl(
        photoUrl,
        fetchWidth,
        fetchHeight,
        false,
        label,
        10000
      );
      results.push(fetched);
    } catch {
      // Try next photo candidate
    }
  }

  return results;
}

async function tryTogetherFluxImage(params: {
  prompt: string;
  width: number;
  height: number;
  togetherKey: string;
  onStatus?: (msg: string) => void;
}): Promise<FetchedAiImageResult | null> {
  const { prompt, width, height, togetherKey, onStatus } = params;
  onStatus?.('Generating HD image via Together AI (FLUX.1-schnell-Free)...');

  try {
    const proxyRes = await fetch('/api/generate/together-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        width,
        height,
        togetherKey,
      }),
    });

    if (proxyRes.ok) {
      const data = (await proxyRes.json()) as {
        imageDataUrl?: string;
        modelUsed?: string;
      };
      if (data.imageDataUrl) {
        const res = await fetch(data.imageDataUrl);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        try {
          const img = await loadImageFromObjectUrl(objectUrl, 12000);
          return {
            img,
            blob,
            objectUrl,
            providerLabel: `Together AI (${data.modelUsed?.includes('Free') ? 'FLUX.1-schnell-Free' : 'FLUX.1-schnell'})`,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          throw err;
        }
      }
    } else if (proxyRes.status !== 404) {
      return null;
    }
  } catch {
    // Try direct Together AI REST API below when running in static deployment
  }

  const models = ['black-forest-labs/FLUX.1-schnell-Free', 'black-forest-labs/FLUX.1-schnell'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.together.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${togetherKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          width,
          height,
          steps: 4,
          n: 1,
          response_format: 'b64_json',
        }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
          return null;
        }
        continue;
      }
      const data = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const first = data.data?.[0];
      let blob: Blob | null = null;
      if (first?.b64_json) {
        const dataRes = await fetch(`data:image/jpeg;base64,${first.b64_json}`);
        blob = await dataRes.blob();
      } else if (first?.url) {
        const urlRes = await fetch(first.url);
        if (urlRes.ok) blob = await urlRes.blob();
      }
      if (!blob || blob.size < 4000) continue;
      const objectUrl = URL.createObjectURL(blob);
      const img = await loadImageFromObjectUrl(objectUrl, 12000);
      return {
        img,
        blob,
        objectUrl,
        providerLabel: `Together AI (${model.includes('Free') ? 'FLUX.1-schnell-Free' : 'FLUX.1-schnell'})`,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    } catch {
      // Fall through to Pollinations Flux
    }
  }

  return null;
}

interface CachedImageEntry {
  blob: Blob;
  providerLabel: string;
  width: number;
  height: number;
  createdAt: number;
}

const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const imageResultCache = new Map<string, CachedImageEntry>();

function buildImageCacheKey(
  prompt: string,
  aspectRatio: AspectRatio,
  style: StylePresetId,
  seed?: number
): string {
  return `${aspectRatio}|${style}|${seed ?? 'rand'}|${prompt.trim().toLowerCase()}`;
}

export async function fetchFreeAiImageWithWaterfall(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  seed?: number;
  togetherKey?: string;
  onStatus?: (msg: string) => void;
  onProgress?: (percent: number, msg: string) => void;
}): Promise<FetchedAiImageResult> {
  const { prompt, aspectRatio, style, togetherKey, onStatus, onProgress } = params;
  const randomSeed = params.seed ?? Math.floor(100000 + Math.random() * 8999999);
  const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);

  const emitProgress = (percent: number, msg: string) => {
    onStatus?.(msg);
    onProgress?.(percent, msg);
  };

  const styleSuffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const cleanPrompt = sanitizeSafePrompt(
    styleSuffix ? `${prompt}, ${styleSuffix}` : prompt
  );

  // Instant smart cache hit when deterministic seed/prompt already rendered
  if (params.seed !== undefined) {
    const cacheKey = buildImageCacheKey(cleanPrompt, aspectRatio, style, params.seed);
    const cached = imageResultCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < IMAGE_CACHE_TTL_MS) {
      emitProgress(92, `Loaded from Smart Image Cache (${cached.providerLabel})...`);
      const objectUrl = URL.createObjectURL(cached.blob);
      try {
        const img = await loadImageFromObjectUrl(objectUrl, 5000);
        return {
          img,
          blob: cached.blob,
          objectUrl,
          providerLabel: `${cached.providerLabel} (Cached)`,
          width: cached.width,
          height: cached.height,
        };
      } catch {
        URL.revokeObjectURL(objectUrl);
        imageResultCache.delete(cacheKey);
      }
    }
  }

  const encodedPrompt = encodeURIComponent(cleanPrompt);
  const trimmedTogether = togetherKey?.trim() || '';

  const saveToCache = (res: FetchedAiImageResult) => {
    if (params.seed === undefined) return;
    const cacheKey = buildImageCacheKey(cleanPrompt, aspectRatio, style, params.seed);
    if (imageResultCache.size >= 16) {
      const oldest = imageResultCache.keys().next().value;
      if (oldest) imageResultCache.delete(oldest);
    }
    imageResultCache.set(cacheKey, {
      blob: res.blob,
      providerLabel: res.providerLabel,
      width: res.width,
      height: res.height,
      createdAt: Date.now(),
    });
  };

  // Race Together AI FLUX.1-schnell-Free (when active) OR race Pollinations Flux + Turbo in parallel (3-8s)
  if (trimmedTogether) {
    emitProgress(28, 'Fast-routing to Together AI (FLUX.1-schnell-Free)...');
    const togetherResult = await tryTogetherFluxImage({
      prompt: cleanPrompt,
      width: fetchWidth,
      height: fetchHeight,
      togetherKey: trimmedTogether,
      onStatus: (m) => emitProgress(54, m),
    });
    if (togetherResult) {
      emitProgress(92, 'Image generated via Together AI FLUX!');
      saveToCache(togetherResult);
      return togetherResult;
    }
    emitProgress(46, 'Together AI unavailable — racing Pollinations Flux & Turbo...');
  }

  const primaryFluxUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&model=flux&seed=${randomSeed}`;
  const backupTurboUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&model=turbo&seed=${randomSeed}`;
  const fastKleinUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    sanitizeSafePrompt(prompt)
  )}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&model=flux&seed=${randomSeed + 7}`;

  emitProgress(38, 'Racing Pollinations Flux & Turbo AI in parallel (3–8s target)...');

  try {
    const raced = await Promise.any([
      fetchAndValidateImageUrl(
        primaryFluxUrl,
        fetchWidth,
        fetchHeight,
        true,
        'Pollinations Flux AI',
        11000
      ),
      fetchAndValidateImageUrl(
        backupTurboUrl,
        fetchWidth,
        fetchHeight,
        true,
        'Pollinations Turbo AI',
        9500
      ),
    ]);
    emitProgress(92, `Delivered via ${raced.providerLabel}!`);
    saveToCache(raced);
    return raced;
  } catch {
    emitProgress(64, 'Trying clean alternate Flux seed...');
    try {
      const retry = await fetchAndValidateImageUrl(
        fastKleinUrl,
        fetchWidth,
        fetchHeight,
        true,
        'Pollinations Flux (Fast Retry)',
        11000
      );
      saveToCache(retry);
      return retry;
    } catch {
      // Fall through cleanly to HD photographic fallback
    }
  }

  // Real HD Photographic Fallback (Wikimedia Commons + Verified Unsplash HD Photography)
  emitProgress(78, 'Searching matching HD photography fallback...');
  const photos = await fetchRealPhotoFallbackList(prompt, aspectRatio, 1, onStatus);
  if (photos.length > 0) {
    saveToCache(photos[0]);
    return photos[0];
  }

  throw new Error(
    'Could not load an AI image or fallback photograph right now. Please check your connection and try again.'
  );
}

export interface FastKeyframeResult {
  img: HTMLImageElement;
  objectUrl: string;
  isAiGenerated: boolean;
}

async function tryPollinationsKeyframe(params: {
  scenePrompt: string;
  aspectRatio: AspectRatio;
  style: StylePresetId;
  seed: number;
  preferTurboFirst?: boolean;
}): Promise<FastKeyframeResult | null> {
  const { scenePrompt, aspectRatio, style, seed, preferTurboFirst } = params;
  const { fetchWidth, fetchHeight } = getWaterfallDimensions(aspectRatio);
  const styleSuffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const cleanPrompt = sanitizeSafePrompt(
    styleSuffix ? `${scenePrompt}, ${styleSuffix}` : scenePrompt
  );
  const encodedPrompt = encodeURIComponent(cleanPrompt);

  const fluxUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&model=flux&seed=${seed}`;
  const turboUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${fetchWidth}&height=${fetchHeight}&nologo=true&model=turbo&seed=${seed + 99}`;

  const order = preferTurboFirst
    ? [
        { url: turboUrl, label: 'Pollinations Turbo AI' },
        { url: fluxUrl, label: 'Pollinations Flux AI' },
      ]
    : [
        { url: fluxUrl, label: 'Pollinations Flux AI' },
        { url: turboUrl, label: 'Pollinations Turbo AI' },
      ];

  for (const attempt of order) {
    try {
      const result = await fetchAndValidateImageUrl(
        attempt.url,
        fetchWidth,
        fetchHeight,
        true,
        attempt.label,
        10000
      );
      return {
        img: result.img,
        objectUrl: result.objectUrl,
        isAiGenerated: true,
      };
    } catch {
      // Try next model
    }
  }

  return null;
}

export async function fetchThreeVideoKeyframesParallel(params: {
  basePrompt: string;
  scenePrompts: [string, string, string];
  aspectRatio: AspectRatio;
  style: StylePresetId;
  onStatus?: (msg: string) => void;
}): Promise<[FastKeyframeResult, FastKeyframeResult, FastKeyframeResult]> {
  const { basePrompt, scenePrompts, aspectRatio, style, onStatus } = params;
  const baseSeed = Math.floor(100000 + Math.random() * 8999999);

  onStatus?.('Generating 3 distinct AI cinematic frames (Pollinations Flux & Turbo)...');

  const [ai1, ai2, ai3] = await Promise.all([
    tryPollinationsKeyframe({
      scenePrompt: scenePrompts[0],
      aspectRatio,
      style,
      seed: baseSeed,
      preferTurboFirst: false,
    }),
    tryPollinationsKeyframe({
      scenePrompt: scenePrompts[1],
      aspectRatio,
      style,
      seed: baseSeed + 137,
      preferTurboFirst: true,
    }),
    tryPollinationsKeyframe({
      scenePrompt: scenePrompts[2],
      aspectRatio,
      style,
      seed: baseSeed + 293,
      preferTurboFirst: false,
    }),
  ]);

  const validAi = [ai1, ai2, ai3].filter((item): item is FastKeyframeResult => Boolean(item));
  if (validAi.length === 3) {
    return [validAi[0], validAi[1], validAi[2]];
  }

  // Fill any missing slots using real HD photography matching prompt keywords (never show error banners)
  const needed = 3 - validAi.length;
  onStatus?.(
    validAi.length > 0
      ? 'Completing 3-scene storyboard with matching HD photography...'
      : 'Loading 3 high-detail cinematic scenes matching your prompt...'
  );
  const photos = await fetchRealPhotoFallbackList(basePrompt, aspectRatio, needed, onStatus);
  const photoFrames: FastKeyframeResult[] = photos.map((p) => ({
    img: p.img,
    objectUrl: p.objectUrl,
    isAiGenerated: false,
  }));

  const combined = [...validAi, ...photoFrames];
  if (combined.length >= 3) {
    return [combined[0], combined[1], combined[2]];
  }
  if (combined.length === 2) {
    return [combined[0], combined[1], combined[0]];
  }
  if (combined.length === 1) {
    return [combined[0], combined[0], combined[0]];
  }

  throw new Error(
    'Unable to load AI scenes or HD photography right now. Please check your internet connection and try again.'
  );
}

export async function fetchFastVideoKeyframesParallel(params: {
  basePrompt: string;
  scenePrompts: [string, string];
  aspectRatio: AspectRatio;
  style: StylePresetId;
  onStatus?: (msg: string) => void;
}): Promise<[FastKeyframeResult, FastKeyframeResult]> {
  const [f1, f2] = await fetchThreeVideoKeyframesParallel({
    basePrompt: params.basePrompt,
    scenePrompts: [params.scenePrompts[0], params.scenePrompts[1], params.scenePrompts[0]],
    aspectRatio: params.aspectRatio,
    style: params.style,
    onStatus: params.onStatus,
  });
  return [f1, f2];
}
