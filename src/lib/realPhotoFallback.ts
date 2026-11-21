import type { AspectRatio } from '../types/studio';

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'with', 'and', 'or', 'by', 'from',
  'into', 'over', 'across', 'through', 'under', 'walking', 'running', 'flying', 'moving',
  'standing', 'looking', 'glowing', 'cinematic', 'dramatic', 'wide', 'establishing', 'opening',
  'shot', 'scene', 'close', 'closeup', 'action', 'finale', 'epic', 'ultra', 'detailed', '4k',
  '8k', 'hd', 'photorealistic', 'lighting', 'atmospheric', 'rich', 'depth', 'volumetric', 'rim',
  'vivid', 'motion', 'film', 'still', 'camera', 'majestic', 'beautiful', 'stunning',
]);

export function extractSearchKeywords(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FILLER_WORDS.has(w));

  const unique = Array.from(new Set(words)).slice(0, 4);
  if (unique.length === 0) return 'cinematic nature landscape';
  return unique.join(' ');
}

interface WikimediaImageInfo {
  thumburl?: string;
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
}

interface WikimediaPage {
  pageid?: number;
  title?: string;
  imageinfo?: WikimediaImageInfo[];
}

export async function searchWikimediaCommonsPhotos(
  prompt: string,
  limit = 6
): Promise<string[]> {
  const keywords = extractSearchKeywords(prompt);
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
    `${keywords} filetype:bitmap`
  )}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1024&format=json&origin=*`;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(apiUrl, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) return [];

    const data = (await res.json()) as {
      query?: { pages?: Record<string, WikimediaPage> };
    };
    const pages = Object.values(data.query?.pages ?? {});
    const urls: string[] = [];

    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const mime = (info.mime ?? '').toLowerCase();
      if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
        continue;
      }
      if ((info.width ?? 0) < 500 || (info.height ?? 0) < 350) {
        continue;
      }
      const chosen = info.thumburl || info.url;
      if (chosen && !chosen.includes('.svg') && !chosen.includes('.tif')) {
        // Strip tracking query params if thumburl returned clean upload path, or keep as-is
        urls.push(chosen);
      }
    }

    return urls;
  } catch {
    window.clearTimeout(timer);
    return [];
  }
}

const CURATED_UNSPLASH_POOLS: Array<{ pattern: RegExp; ids: [string, string] }> = [
  {
    pattern: /lion|tiger|panther|leopard|cheetah|savanna|safari/,
    ids: ['photo-1546182990-dffeafbe841d', 'photo-1614027164847-1b28cfe1df60'],
  },
  {
    pattern: /cyber|neon|future|sci-fi|robot|synth|tokyo|blade|night city/,
    ids: ['photo-1519608487953-e999c86e7455', 'photo-1555680202-c86f0e12f086'],
  },
  {
    pattern: /jungle|forest|tree|woods|rainforest|nature|wild/,
    ids: ['photo-1448375240586-882707db888b', 'photo-1511497584788-876760111969'],
  },
  {
    pattern: /ocean|sea|water|beach|wave|island|underwater/,
    ids: ['photo-1507525428034-b723cf961d3e', 'photo-1505118380757-91f5f5632de0'],
  },
  {
    pattern: /space|galaxy|cosmos|nebula|planet|star|astronaut|moon|universe/,
    ids: ['photo-1462331940025-496dfbfc7564', 'photo-1451187580459-43490279c0fa'],
  },
  {
    pattern: /car|supercar|vehicle|racing|road|highway|motorcycle/,
    ids: ['photo-1503376780353-7e6692767b70', 'photo-1492144534655-ae79c964c9d7'],
  },
  {
    pattern: /sunset|sunrise|golden|dusk|dawn|sky|clouds/,
    ids: ['photo-1495616811223-4d98c6e9c869', 'photo-1506744038136-46273834b3fb'],
  },
  {
    pattern: /mountain|alpine|peak|snow|valley|cliff|landscape/,
    ids: ['photo-1464822759023-fed622ff2c3b', 'photo-1506744038136-46273834b3fb'],
  },
];

export function getCuratedHdPhotoUrls(
  prompt: string,
  aspectRatio: AspectRatio
): [string, string] {
  const lower = prompt.toLowerCase();
  const w = aspectRatio === '9:16' ? 576 : aspectRatio === '1:1' ? 768 : 1024;
  const h = aspectRatio === '9:16' ? 1024 : aspectRatio === '1:1' ? 768 : 576;

  let chosenIds: [string, string] = [
    'photo-1506744038136-46273834b3fb',
    'photo-1495616811223-4d98c6e9c869',
  ];

  for (const pool of CURATED_UNSPLASH_POOLS) {
    if (pool.pattern.test(lower)) {
      chosenIds = pool.ids;
      break;
    }
  }

  // If prompt combines wildlife + jungle/cyberpunk/sunset, pair distinct matched photos!
  const matchedPools = CURATED_UNSPLASH_POOLS.filter((p) => p.pattern.test(lower));
  if (matchedPools.length >= 2) {
    chosenIds = [matchedPools[0].ids[0], matchedPools[1].ids[0]];
  }

  return [
    `https://images.unsplash.com/${chosenIds[0]}?auto=format&fit=crop&w=${w}&h=${h}&q=85`,
    `https://images.unsplash.com/${chosenIds[1]}?auto=format&fit=crop&w=${w}&h=${h}&q=85`,
  ];
}
