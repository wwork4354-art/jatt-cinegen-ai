import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { TopNav } from './components/TopNav';
import { PromptPanel } from './components/PromptPanel';
import { PreviewStage } from './components/PreviewStage';
import { CreationsGallery } from './components/CreationsGallery';
import { ShareModal } from './components/ShareModal';
import { DeveloperFooter } from './components/DeveloperFooter';
import { dataUrlToBlob, deleteCreation, loadCreations, saveCreation } from './lib/creationsDb';
import { renderDemoVideo } from './lib/demoVideoRenderer';
import { fetchFreeAiImageWithWaterfall } from './lib/freeImageWaterfall';
import { getLanguageMeta, getUIStrings, type LanguageCode } from './lib/i18n';
import { translatePromptToEnglish } from './lib/voiceLanguages';
import {
  type AspectRatio,
  type CameraMotionId,
  type CreationItem,
  type DeveloperProfile,
  type GenerationProgress,
  type StudioTab,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
  type VideoSourceMode,
} from './types/studio';

const CUSTOM_BACKEND_STORAGE_KEY = 'vesper_custom_video_backend_url';
const LANGUAGE_STORAGE_KEY = 'jatt_cinegen_language';
const DEV_PROFILE_STORAGE_KEY = 'jatt_cinegen_developer_profile';
const DEFAULT_CREATOR_AVATAR = '/creator-avatar.png';

const DEFAULT_DEV_PROFILE: DeveloperProfile = {
  avatarDataUrl: DEFAULT_CREATOR_AVATAR,
  youtubeUrl: '',
  instagramUrl: '',
  websiteUrl: '',
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read media blob'));
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('text-to-video');
  const [language, setLanguage] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguageCode | null;
      return saved || 'en';
    } catch {
      return 'en';
    }
  });
  const [voiceLanguageId, setVoiceLanguageId] = useState<string>('en');

  const [prompt, setPrompt] = useState('');
  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [stylePreset, setStylePreset] = useState<StylePresetId>('cinematic');
  const [duration, setDuration] = useState<VideoDuration>('15s');
  const [cameraMotion, setCameraMotion] = useState<CameraMotionId>('dolly-push');
  const [quality, setQuality] = useState<VideoQuality>('720p');
  const [voiceoverEnabled, setVoiceoverEnabled] = useState(false);
  const [backgroundMusicFile, setBackgroundMusicFile] = useState<File | null>(null);
  const [videoSourceMode, setVideoSourceMode] = useState<VideoSourceMode>('hf-gpu');
  const [customBackendUrl, setCustomBackendUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(CUSTOM_BACKEND_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [developerProfile, setDeveloperProfile] = useState<DeveloperProfile>(() => {
    try {
      const saved = localStorage.getItem(DEV_PROFILE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DeveloperProfile>;
        return {
          ...DEFAULT_DEV_PROFILE,
          ...parsed,
          avatarDataUrl: parsed.avatarDataUrl || DEFAULT_CREATOR_AVATAR,
        };
      }
    } catch {
      // Ignore storage parse error
    }
    return DEFAULT_DEV_PROFILE;
  });

  const [creations, setCreations] = useState<CreationItem[]>([]);
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null);
  const [isLivePreviewActive, setIsLivePreviewActive] = useState(false);
  const [shareItem, setShareItem] = useState<CreationItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gpuBusyNotice, setGpuBusyNotice] = useState<string | null>(null);

  const [progress, setProgress] = useState<GenerationProgress>({
    active: false,
    percent: 0,
    statusMessage: '',
    elapsedSeconds: 0,
  });

  const timerRef = useRef<number | null>(null);
  const stageTimersRef = useRef<number[]>([]);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const strings = useMemo(() => getUIStrings(language), [language]);
  const langMeta = useMemo(() => getLanguageMeta(language), [language]);

  // Load persisted creations on mount
  useEffect(() => {
    let mounted = true;
    loadCreations().then((items) => {
      if (!mounted) return;
      setCreations(items);
      if (items.length > 0) {
        setActiveCreationId(items[0].id);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Persist language & custom backend URL
  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore storage errors
    }
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, customBackendUrl);
    } catch {
      // Ignore storage quota errors
    }
  }, [customBackendUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(DEV_PROFILE_STORAGE_KEY, JSON.stringify(developerProfile));
    } catch {
      // Ignore storage quota errors
    }
  }, [developerProfile]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const id of stageTimersRef.current) {
      window.clearTimeout(id);
    }
    stageTimersRef.current = [];
  }, []);

  const startTimer = useCallback(
    (initialMessage: string) => {
      stopTimer();
      const startedAt = performance.now();
      setProgress({
        active: true,
        percent: 8,
        statusMessage: initialMessage,
        elapsedSeconds: 0,
      });

      timerRef.current = window.setInterval(() => {
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        setProgress((prev) =>
          prev.active ? { ...prev, elapsedSeconds } : prev
        );
      }, 100);
    },
    [stopTimer]
  );

  useEffect(() => () => stopTimer(), [stopTimer]);

  const activeCreation = useMemo(
    () => creations.find((c) => c.id === activeCreationId) ?? null,
    [creations, activeCreationId]
  );

  const recentImages = useMemo(
    () => creations.filter((c) => c.kind === 'image'),
    [creations]
  );

  const persistNewCreation = useCallback(async (item: CreationItem) => {
    await saveCreation(item);
    setCreations((prev) => [item, ...prev]);
    setActiveCreationId(item.id);
  }, []);

  const handleEnhancePrompt = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isEnhancing) return;

    setIsEnhancing(true);
    setErrorMessage(null);
    const mode = activeTab === 'creations' ? 'text-to-video' : activeTab;

    try {
      const res = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          mode,
          style: stylePreset,
          cameraMotion,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Prompt enhancement server endpoint is unavailable.');
      }
      const data = (await res.json()) as { enhancedPrompt?: string; error?: string };
      if (!res.ok || !data.enhancedPrompt) {
        throw new Error(data.error || 'Could not enhance prompt.');
      }
      setPreviousPrompt(trimmed);
      setPrompt(data.enhancedPrompt);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Prompt enhancement failed.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const runFastDemoReel = async (
    trimmedPrompt: string,
    targetMode: 'text-to-video' | 'image-to-video'
  ) => {
    setErrorMessage(null);
    setGpuBusyNotice(null);
    startTimer(
      targetMode === 'text-to-video'
        ? 'Generating AI Scenes via Pollinations AI...'
        : 'Preparing uploaded image...'
    );
    try {
      const result = await renderDemoVideo({
        prompt: trimmedPrompt,
        aspectRatio,
        duration,
        cameraMotion,
        quality,
        style: stylePreset,
        sourceImageDataUrl:
          targetMode === 'image-to-video' ? uploadedImageUrl ?? undefined : undefined,
        backgroundMusicFile,
        voiceoverEnabled,
        speechLocale: langMeta.speechLocale,
        voiceLanguageId,
        onFrameCanvas: (sourceCanvas) => {
          setIsLivePreviewActive((prev) => (prev ? prev : true));
          const target = liveCanvasRef.current;
          if (!target) return;
          const maxPreviewSide = 1280;
          const scale = Math.min(
            1,
            maxPreviewSide / Math.max(sourceCanvas.width, sourceCanvas.height)
          );
          const previewW = Math.round(sourceCanvas.width * scale);
          const previewH = Math.round(sourceCanvas.height * scale);
          if (target.width !== previewW || target.height !== previewH) {
            target.width = previewW;
            target.height = previewH;
          }
          const tctx = target.getContext('2d');
          if (tctx) {
            tctx.drawImage(sourceCanvas, 0, 0, previewW, previewH);
          }
        },
        onProgress: (percent, statusMessage, remainingSeconds) => {
          setProgress((prev) =>
            prev.active
              ? { ...prev, percent, statusMessage, remainingSeconds }
              : prev
          );
        },
      });

      const qualityTag = quality === '4k' ? '4K Ultra HD' : quality;
      const item: CreationItem = {
        id: crypto.randomUUID(),
        kind: 'video',
        sourceMode: targetMode,
        prompt: trimmedPrompt,
        style: stylePreset,
        aspectRatio,
        width: result.width,
        height: result.height,
        duration,
        cameraMotion,
        quality,
        engineLabel:
          targetMode === 'text-to-video'
            ? `Fast 3-Scene Reel (${qualityTag})`
            : `CineGen ${qualityTag} Animate`,
        scenes: result.scenes,
        mediaUrl: result.mediaUrl,
        mimeType: result.mimeType,
        createdAt: Date.now(),
        blob: result.blob,
      };

      await persistNewCreation(item);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Video rendering failed.');
    } finally {
      stopTimer();
      setIsLivePreviewActive(false);
      setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    }
  };

  const runHfGpuVideo = async (
    trimmedPrompt: string,
    targetMode: 'text-to-video' | 'image-to-video'
  ) => {
    setErrorMessage(null);
    setGpuBusyNotice(null);
    startTimer('Connecting to Free AI Video GPU...');

    try {
      const { englishPrompt } = await translatePromptToEnglish(
        trimmedPrompt,
        voiceLanguageId
      );
      const effectivePrompt = englishPrompt || trimmedPrompt;

      let imagePayload = uploadedImageUrl ?? undefined;
      if (targetMode === 'image-to-video' && uploadedImageUrl?.startsWith('blob:')) {
        const fetched = await fetch(uploadedImageUrl);
        imagePayload = await blobToDataUrl(await fetched.blob());
      }

      const response = await fetch('/api/generate/hf-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          mode: targetMode,
          aspectRatio,
          style: stylePreset,
          imageDataUrl: targetMode === 'image-to-video' ? imagePayload : undefined,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Free GPU queue is currently busy or unavailable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const jsonText = line.slice(5).trim();
          if (!jsonText) continue;

          const evt = JSON.parse(jsonText) as {
            type: 'progress' | 'done' | 'busy';
            percent?: number;
            message: string;
            providerLabel?: string;
            videoApiPath?: string;
            mimeType?: string;
            width?: number;
            height?: number;
          };

          if (evt.type === 'progress') {
            setProgress((prev) =>
              prev.active
                ? {
                    ...prev,
                    percent: evt.percent ?? prev.percent,
                    statusMessage: evt.message,
                  }
                : prev
            );
          } else if (evt.type === 'busy') {
            setGpuBusyNotice(evt.message);
            completed = true;
          } else if (evt.type === 'done' && evt.videoApiPath) {
            setProgress((prev) =>
              prev.active
                ? {
                    ...prev,
                    percent: 95,
                    statusMessage: 'Preparing MP4 playback...',
                  }
                : prev
            );

            const mediaRes = await fetch(evt.videoApiPath);
            if (!mediaRes.ok) {
              throw new Error('Could not load generated MP4 from server.');
            }
            const blob = await mediaRes.blob();
            const mediaUrl = URL.createObjectURL(blob);

            const item: CreationItem = {
              id: crypto.randomUUID(),
              kind: 'video',
              sourceMode: targetMode,
              prompt: trimmedPrompt,
              style: stylePreset,
              aspectRatio,
              width: evt.width ?? 704,
              height: evt.height ?? 512,
              duration,
              cameraMotion,
              quality,
              engineLabel: evt.providerLabel || 'Free AI Video GPU',
              mediaUrl,
              mimeType: evt.mimeType || 'video/mp4',
              createdAt: Date.now(),
              blob,
            };

            await persistNewCreation(item);
            completed = true;
          }
        }
      }

      if (!completed) {
        setGpuBusyNotice('Free GPU busy — retrying or switch to Fast 3-Scene Reel');
      }
    } catch (err) {
      setGpuBusyNotice(
        err instanceof Error
          ? err.message
          : 'Free GPU busy — retrying or switch to Fast 3-Scene Reel'
      );
    } finally {
      stopTimer();
      setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    }
  };

  const handleGenerate = async () => {
    if (activeTab === 'creations' || progress.active) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setErrorMessage(null);
    setGpuBusyNotice(null);

    // Direct frontend Multi-Provider Free AI Image Waterfall (blocks rate-limit/refusal banners)
    if (activeTab === 'text-to-image') {
      startTimer('Preparing AI prompt...');
      try {
        const { englishPrompt } = await translatePromptToEnglish(trimmedPrompt, voiceLanguageId);
        const result = await fetchFreeAiImageWithWaterfall({
          prompt: englishPrompt || trimmedPrompt,
          aspectRatio,
          style: stylePreset,
          onStatus: (msg) => {
            setProgress((p) => (p.active ? { ...p, percent: 48, statusMessage: msg } : p));
          },
        });

        setProgress((p) =>
          p.active ? { ...p, percent: 94, statusMessage: 'Saving Full HD image to My Creations...' } : p
        );

        const item: CreationItem = {
          id: crypto.randomUUID(),
          kind: 'image',
          sourceMode: 'text-to-image',
          prompt: trimmedPrompt,
          style: stylePreset,
          aspectRatio,
          width: result.width,
          height: result.height,
          engineLabel: result.providerLabel,
          mediaUrl: result.objectUrl,
          mimeType: result.blob.type || 'image/jpeg',
          createdAt: Date.now(),
          blob: result.blob,
        };

        await persistNewCreation(item);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Could not generate image from free AI providers. Please try again.'
        );
      } finally {
        stopTimer();
        setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
      }
      return;
    }

    // Video generation (Text to Video OR Image to Video)
    if (videoSourceMode === 'hf-gpu') {
      await runHfGpuVideo(trimmedPrompt, activeTab);
      return;
    }

    if (videoSourceMode === 'demo') {
      await runFastDemoReel(trimmedPrompt, activeTab);
      return;
    }

    // Custom Backend URL Mode
    startTimer('Sending request to custom video backend...');
    const proxyStageTimer = window.setTimeout(() => {
      setProgress((p) =>
        p.active
          ? {
              ...p,
              percent: 45,
              statusMessage: `Rendering ${duration} ${quality} video on your custom endpoint...`,
            }
          : p
      );
    }, 1400);

    try {
      let imagePayload = uploadedImageUrl;
      if (activeTab === 'image-to-video' && uploadedImageUrl?.startsWith('blob:')) {
        const fetched = await fetch(uploadedImageUrl);
        imagePayload = await blobToDataUrl(await fetched.blob());
      }

      const res = await fetch('/api/generate/video-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backendUrl: customBackendUrl.trim(),
          mode: activeTab,
          prompt: trimmedPrompt,
          style: stylePreset,
          duration,
          aspectRatio,
          cameraMotion,
          quality,
          imageDataUrl: activeTab === 'image-to-video' ? imagePayload : undefined,
        }),
      });

      clearTimeout(proxyStageTimer);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Video proxy endpoint returned an unexpected response.');
      }
      const data = (await res.json()) as {
        videoDataUrl?: string;
        videoUrl?: string;
        mimeType?: string;
        error?: string;
      };

      if (!res.ok || (!data.videoDataUrl && !data.videoUrl)) {
        throw new Error(data.error || 'Custom video backend returned an error.');
      }

      setProgress((p) => ({
        ...p,
        percent: 94,
        statusMessage: 'Preparing video playback...',
      }));

      let blob: Blob | undefined;
      let mediaUrl = data.videoUrl ?? '';
      if (data.videoDataUrl) {
        blob = dataUrlToBlob(data.videoDataUrl);
        mediaUrl = URL.createObjectURL(blob);
      }

      const dims =
        aspectRatio === '9:16'
          ? quality === '4k'
            ? { width: 2160, height: 3840 }
            : quality === '1080p'
            ? { width: 1080, height: 1920 }
            : { width: 720, height: 1280 }
          : aspectRatio === '1:1'
          ? quality === '4k'
            ? { width: 2160, height: 2160 }
            : quality === '1080p'
            ? { width: 1080, height: 1080 }
            : { width: 720, height: 720 }
          : quality === '4k'
          ? { width: 3840, height: 2160 }
          : quality === '1080p'
          ? { width: 1920, height: 1080 }
          : { width: 1280, height: 720 };

      const item: CreationItem = {
        id: crypto.randomUUID(),
        kind: 'video',
        sourceMode: activeTab,
        prompt: trimmedPrompt,
        style: stylePreset,
        aspectRatio,
        width: dims.width,
        height: dims.height,
        duration,
        cameraMotion,
        quality,
        engineLabel: 'Custom Backend API',
        mediaUrl,
        mimeType: data.mimeType ?? 'video/mp4',
        createdAt: Date.now(),
        blob,
      };

      await persistNewCreation(item);
    } catch (err) {
      clearTimeout(proxyStageTimer);
      setErrorMessage(err instanceof Error ? err.message : 'Custom video request failed.');
    } finally {
      stopTimer();
      setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    }
  };

  const handleDownload = useCallback(async (item: CreationItem) => {
    const ext =
      item.kind === 'image'
        ? item.mimeType.includes('png')
          ? 'png'
          : 'jpg'
        : item.mimeType.includes('mp4')
        ? 'mp4'
        : 'webm';
    const filename = `jatt-cinegen-ai-${item.kind}-${item.width}x${item.height}.${ext}`;

    try {
      const resolvedBlob: Blob =
        item.blob ??
        (await fetch(item.mediaUrl).then((r) => {
          if (!r.ok) {
            throw new Error('Failed to fetch media for download.');
          }
          return r.blob();
        }));

      const objectUrl = URL.createObjectURL(resolvedBlob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not download asset.'
      );
    }
  }, []);

  const handleDeleteCreation = useCallback(
    async (id: string) => {
      await deleteCreation(id);
      setCreations((prev) => {
        const target = prev.find((c) => c.id === id);
        if (target?.mediaUrl.startsWith('blob:')) {
          URL.revokeObjectURL(target.mediaUrl);
        }
        const remaining = prev.filter((c) => c.id !== id);
        if (activeCreationId === id) {
          setActiveCreationId(remaining[0]?.id ?? null);
        }
        return remaining;
      });
    },
    [activeCreationId]
  );

  const handleInspectCreation = useCallback((item: CreationItem) => {
    setActiveCreationId(item.id);
    setPrompt(item.prompt);
    setAspectRatio(item.aspectRatio);
    setStylePreset(item.style);
    if (item.duration) setDuration(item.duration);
    if (item.cameraMotion) setCameraMotion(item.cameraMotion);
    if (item.quality) setQuality(item.quality);
    setActiveTab(item.sourceMode);
  }, []);

  const handleAnimateImage = useCallback(
    async (item: CreationItem) => {
      let sourceUrl = item.mediaUrl;
      if (item.blob) {
        sourceUrl = await blobToDataUrl(item.blob);
      }
      setUploadedImageUrl(sourceUrl);
      setActiveTab('image-to-video');
      setAspectRatio(item.aspectRatio);
      if (!prompt.trim()) {
        setPrompt('Subtle cinematic camera push-in with gentle atmospheric lighting drift');
      }
    },
    [prompt]
  );

  const handleResetWorkspace = useCallback(() => {
    setPrompt('');
    setPreviousPrompt(null);
    stopTimer();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsLivePreviewActive(false);
    setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    setActiveCreationId(null);
    setErrorMessage(null);
    setGpuBusyNotice(null);
    if (activeTab === 'creations') {
      setActiveTab('text-to-video');
    }
    if (activeTab === 'image-to-video') {
      setUploadedImageUrl(null);
    }
  }, [activeTab, stopTimer]);

  return (
    <div
      dir={langMeta.rtl ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col"
    >
      <TopNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setErrorMessage(null);
          setGpuBusyNotice(null);
          setActiveTab(tab);
        }}
        creationsCount={creations.length}
        onResetWorkspace={handleResetWorkspace}
        strings={strings}
        developerAvatarUrl={developerProfile.avatarDataUrl}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {activeTab === 'creations' ? (
          <motion.div
            key="creations"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <CreationsGallery
              creations={creations}
              onInspect={handleInspectCreation}
              onDownload={handleDownload}
              onShare={(item) => setShareItem(item)}
              onDelete={handleDeleteCreation}
              onStartCreating={() => setActiveTab('text-to-video')}
              strings={strings}
            />
          </motion.div>
        ) : (
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-8"
          >
            {/* Primary 2-Column Generation Studio */}
            <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
              <div className="w-full lg:w-[460px] xl:w-[490px] shrink-0">
                <PromptPanel
                  mode={activeTab}
                  language={language}
                  onLanguageChange={setLanguage}
                  voiceLanguageId={voiceLanguageId}
                  onVoiceLanguageChange={setVoiceLanguageId}
                  strings={strings}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  previousPrompt={previousPrompt}
                  onUndoEnhance={() => {
                    if (previousPrompt !== null) {
                      setPrompt(previousPrompt);
                      setPreviousPrompt(null);
                    }
                  }}
                  onEnhancePrompt={handleEnhancePrompt}
                  isEnhancing={isEnhancing}
                  aspectRatio={aspectRatio}
                  onAspectRatioChange={setAspectRatio}
                  stylePreset={stylePreset}
                  onStylePresetChange={setStylePreset}
                  duration={duration}
                  onDurationChange={setDuration}
                  cameraMotion={cameraMotion}
                  onCameraMotionChange={setCameraMotion}
                  quality={quality}
                  onQualityChange={setQuality}
                  voiceoverEnabled={voiceoverEnabled}
                  onVoiceoverChange={setVoiceoverEnabled}
                  backgroundMusicFile={backgroundMusicFile}
                  onBackgroundMusicChange={setBackgroundMusicFile}
                  videoSourceMode={videoSourceMode}
                  onVideoSourceModeChange={setVideoSourceMode}
                  customBackendUrl={customBackendUrl}
                  onCustomBackendUrlChange={setCustomBackendUrl}
                  uploadedImageUrl={uploadedImageUrl}
                  onUploadedImageChange={setUploadedImageUrl}
                  recentImages={recentImages}
                  isGenerating={progress.active}
                  onGenerate={handleGenerate}
                />
              </div>

              <PreviewStage
                mode={activeTab}
                aspectRatio={aspectRatio}
                progress={progress}
                activeCreation={activeCreation}
                pendingImageUrl={null}
                pendingImageAlt=""
                onPendingImageLoad={() => {}}
                onPendingImageError={() => {}}
                liveCanvasRef={liveCanvasRef}
                isLivePreviewActive={isLivePreviewActive}
                errorMessage={errorMessage}
                onDismissError={() => setErrorMessage(null)}
                gpuBusyNotice={gpuBusyNotice}
                onDismissGpuBusy={() => setGpuBusyNotice(null)}
                onRetryHfGpu={() => {
                  const trimmed = prompt.trim();
                  if (trimmed && (activeTab === 'text-to-video' || activeTab === 'image-to-video')) {
                    void runHfGpuVideo(trimmed, activeTab);
                  }
                }}
                onFallbackToReel={() => {
                  const trimmed = prompt.trim();
                  setVideoSourceMode('demo');
                  setGpuBusyNotice(null);
                  if (trimmed && (activeTab === 'text-to-video' || activeTab === 'image-to-video')) {
                    void runFastDemoReel(trimmed, activeTab);
                  }
                }}
                onDownload={handleDownload}
                onShare={(item) => setShareItem(item)}
                onAnimateImage={handleAnimateImage}
                strings={strings}
              />
            </div>

            {/* Compact Recent Creations Strip (capped at 6 for 3GB RAM efficiency) */}
            {creations.length > 0 && (
              <section
                aria-label="Recent creations"
                className="space-y-4 border-t border-white/[0.08] pt-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-white">
                    {strings.navMyCreations}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('creations')}
                    className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
                  >
                    View all ({creations.length})
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                  {creations.slice(0, 6).map((item) => {
                    const isSelected = item.id === activeCreationId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleInspectCreation(item)}
                        className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                          isSelected
                            ? 'border-cyan-400 bg-[#0D1118]'
                            : 'border-white/[0.08] bg-[#0D1118] hover:border-white/25'
                        }`}
                      >
                        <div className="aspect-video w-full overflow-hidden bg-black">
                          {item.kind === 'image' ? (
                            <img
                              src={item.mediaUrl}
                              alt={item.prompt}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <video
                              src={item.mediaUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="truncate text-xs font-medium text-slate-200">
                            {item.prompt}
                          </div>
                          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                            {item.kind === 'image' ? 'Image' : `Video · ${item.duration}`}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </motion.div>
        )}
      </main>

      <ShareModal
        item={shareItem}
        onClose={() => setShareItem(null)}
        onDownload={handleDownload}
      />

      <DeveloperFooter
        profile={developerProfile}
        onUpdateProfile={setDeveloperProfile}
        footerCreditLabel={strings.footerCredit}
      />
    </div>
  );
}
