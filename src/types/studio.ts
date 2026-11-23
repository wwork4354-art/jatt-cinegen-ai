export type StudioTab =
  | 'text-to-video'
  | 'image-to-video'
  | 'lip-sync'
  | 'text-to-image'
  | 'creations';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type StylePresetId = 'realistic' | 'anime' | '3d-render' | 'cinematic' | 'none';

export type VideoDuration = '5s' | '10s' | '15s';

export type VideoQuality = '720p' | '1080p' | '4k';

export interface DeveloperProfile {
  avatarDataUrl: string | null;
  youtubeUrl: string;
  instagramUrl: string;
  websiteUrl: string;
}

export type CameraMotionId =
  | 'dolly-push'
  | 'slow-pan'
  | 'aerial-orbit'
  | 'crane-up'
  | 'handheld-drift'
  | 'static';

export type VideoSourceMode = 'hf-gpu' | 'custom-backend';

export interface EngineVaultKeys {
  geminiKey: string;
  hfToken: string;
  siliconFlowKey: string;
  pollinationsKey?: string;
}

export interface StylePresetOption {
  id: StylePresetId;
  label: string;
  description: string;
  thumbnail?: string;
}

export interface CameraMotionOption {
  id: CameraMotionId;
  label: string;
  hint: string;
}

export interface CreationItem {
  id: string;
  kind: 'image' | 'video';
  sourceMode: 'text-to-image' | 'text-to-video' | 'image-to-video' | 'lip-sync';
  prompt: string;
  style: StylePresetId;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  duration?: VideoDuration;
  cameraMotion?: CameraMotionId;
  quality?: VideoQuality;
  engineLabel: string;
  scenes?: string[];
  mediaUrl: string;
  mimeType: string;
  createdAt: number;
  blob?: Blob;
}

export interface GenerationProgress {
  active: boolean;
  percent: number;
  statusMessage: string;
  elapsedSeconds: number;
  remainingSeconds?: number;
}

export const STYLE_PRESETS: StylePresetOption[] = [
  {
    id: 'realistic',
    label: 'Realistic',
    description: '35mm natural grain & optics',
    thumbnail: '/src/assets/images/style_realistic_1794898661347.jpg',
  },
  {
    id: 'anime',
    label: 'Anime',
    description: 'Theatrical cel & sky lighting',
    thumbnail: '/src/assets/images/style_anime_1794898661810.jpg',
  },
  {
    id: '3d-render',
    label: '3D Render',
    description: 'Octane glass & rim caustics',
    thumbnail: '/src/assets/images/style_3d_render_1794898660723.jpg',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: '70mm anamorphic color grade',
    thumbnail: '/src/assets/images/style_cinematic_1794898662012.jpg',
  },
  {
    id: 'none',
    label: 'Raw Prompt',
    description: 'Unstyled direct prompt',
  },
];

export const CAMERA_MOTIONS: CameraMotionOption[] = [
  { id: 'dolly-push', label: 'Dolly Push-In', hint: 'Smooth forward optical zoom' },
  { id: 'slow-pan', label: 'Slow Pan', hint: 'Horizontal cinema sweep' },
  { id: 'aerial-orbit', label: 'Aerial Orbit', hint: 'Circular parallax drift' },
  { id: 'crane-up', label: 'Crane Up', hint: 'Vertical reveal elevation' },
  { id: 'handheld-drift', label: 'Handheld Drift', hint: 'Organic documentary float' },
  { id: 'static', label: 'Static Tripod', hint: 'Locked frame ambient motion' },
];

export const STYLE_PROMPT_SUFFIX: Record<StylePresetId, string> = {
  realistic:
    'photorealistic, ultra-detailed natural textures, Leica 35mm lens, shallow depth of field, authentic lighting, 8k photographic clarity',
  anime:
    'theatrical Japanese anime film still, expressive cel shading, vibrant atmospheric sky, finely detailed linework, Studio Shinkai lighting',
  '3d-render':
    'high-end Octane 3D render, physically based materials, studio rim lighting, raytraced reflections, sculpted geometry, clean volumetric depth',
  cinematic:
    'anamorphic 70mm cinema still, dramatic volumetric lighting, rich teal and amber color grading, atmospheric haze, filmic depth',
  none: '',
};

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export function buildPollinationsImageUrl(
  prompt: string,
  aspectRatio: AspectRatio,
  style: StylePresetId,
  seed: number = Date.now()
): { url: string; width: number; height: number; resolvedPrompt: string } {
  const dims = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS['16:9'];
  const suffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const resolvedPrompt = suffix ? `${prompt}, ${suffix}` : prompt;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    resolvedPrompt
  )}?model=flux&width=${dims.width}&height=${dims.height}&nologo=true&private=true&seed=${seed}`;
  return { url, width: dims.width, height: dims.height, resolvedPrompt };
}

export function buildPollinationsFastKeyframeUrl(
  prompt: string,
  aspectRatio: AspectRatio,
  style: StylePresetId,
  seed: number = Date.now()
): { url: string; fetchWidth: number; fetchHeight: number; resolvedPrompt: string } {
  const fetchWidth = aspectRatio === '9:16' ? 576 : aspectRatio === '1:1' ? 768 : 1024;
  const fetchHeight = aspectRatio === '9:16' ? 1024 : aspectRatio === '1:1' ? 768 : 576;
  const suffix = STYLE_PROMPT_SUFFIX[style] ?? '';
  const resolvedPrompt = suffix ? `${prompt}, ${suffix}` : prompt;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    resolvedPrompt
  )}?model=flux&width=${fetchWidth}&height=${fetchHeight}&nologo=true&private=true&seed=${seed}`;
  return { url, fetchWidth, fetchHeight, resolvedPrompt };
}

