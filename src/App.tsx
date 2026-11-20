import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BadgeCheck } from 'lucide-react';
import { TopNav } from './components/TopNav';
import { PromptPanel } from './components/PromptPanel';
import { PreviewStage } from './components/PreviewStage';
import { CreationsGallery } from './components/CreationsGallery';
import { ShareModal } from './components/ShareModal';
import { dataUrlToBlob, deleteCreation, loadCreations, saveCreation } from './lib/creationsDb';
import { renderDemoVideo } from './lib/demoVideoRenderer';
import { getLanguageMeta, getUIStrings, type LanguageCode } from './lib/i18n';
import {
  buildPollinationsImageUrl,
  type AspectRatio,
  type CameraMotionId,
  type CreationItem,
  type GenerationProgress,
  type StudioTab,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
  type VideoSourceMode,
} from './types/studio';

const CUSTOM_BACKEND_STORAGE_KEY = 'vesper_custom_video_backend_url';
const LANGUAGE_STORAGE_KEY = 'jatt_cinegen_language';

interface PendingImageJob {
  url: string;
  prompt: string;
  style: StylePresetId;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
}

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
  const [videoSourceMode, setVideoSourceMode] = useState<VideoSourceMode>('demo');
  const [customBackendUrl, setCustomBackendUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(CUSTOM_BACKEND_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const [creations, setCreations] = useState<CreationItem[]>([]);
  const [activeCreationId, setActiveCreationId] = useState<string | null>(null);
  const [pendingImageJob, setPendingImageJob] = useState<PendingImageJob | null>(null);
  const [isLivePreviewActive, setIsLivePreviewActive] = useState(false);
  const [shareItem, setShareItem] = useState<CreationItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const handlePendingImageLoad = useCallback(async () => {
    if (!pendingImageJob) return;
    const job = pendingImageJob;
    setPendingImageJob(null);

    setProgress((p) => ({
      ...p,
      percent: 96,
      statusMessage: 'Saving Full HD asset to My Creations...',
    }));

    const item: CreationItem = {
      id: crypto.randomUUID(),
      kind: 'image',
      sourceMode: 'text-to-image',
      prompt: job.prompt,
      style: job.style,
      aspectRatio: job.aspectRatio,
      width: job.width,
      height: job.height,
      engineLabel: 'Pollinations Free AI',
      mediaUrl: job.url,
      mimeType: 'image/jpeg',
      createdAt: Date.now(),
    };

    try {
      await persistNewCreation(item);
    } finally {
      stopTimer();
      setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    }
  }, [pendingImageJob, persistNewCreation, stopTimer]);

  const handlePendingImageError = useCallback(() => {
    if (!pendingImageJob) return;
    setPendingImageJob(null);
    stopTimer();
    setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    setErrorMessage('Could not load image from Pollinations AI. Please try generating again.');
  }, [pendingImageJob, stopTimer]);

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

  const handleGenerate = async () => {
    if (activeTab === 'creations' || progress.active) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setErrorMessage(null);

    // Direct frontend Pollinations AI <img> generation
    if (activeTab === 'text-to-image') {
      const { url, width, height } = buildPollinationsImageUrl(
        trimmedPrompt,
        aspectRatio,
        stylePreset,
        Date.now()
      );

      startTimer('Rendering Full HD image via Pollinations AI...');
      stageTimersRef.current.push(
        window.setTimeout(() => {
          setProgress((p) =>
            p.active ? { ...p, percent: 42, statusMessage: `Synthesizing ${width}×${height} composition...` } : p
          );
        }, 900),
        window.setTimeout(() => {
          setProgress((p) =>
            p.active ? { ...p, percent: 76, statusMessage: 'Refining lighting and Full HD detail...' } : p
          );
        }, 2800)
      );

      setPendingImageJob({
        url,
        prompt: trimmedPrompt,
        style: stylePreset,
        aspectRatio,
        width,
        height,
      });
      return;
    }

    // Video generation (Text to Video OR Image to Video)
    if (videoSourceMode === 'demo') {
      startTimer(
        activeTab === 'text-to-video'
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
          sourceImageDataUrl: activeTab === 'image-to-video' ? uploadedImageUrl ?? undefined : undefined,
          backgroundMusicFile,
          voiceoverEnabled,
          speechLocale: langMeta.speechLocale,
          onFrameCanvas: (sourceCanvas) => {
            setIsLivePreviewActive((prev) => (prev ? prev : true));
            const target = liveCanvasRef.current;
            if (!target) return;
            if (target.width !== sourceCanvas.width || target.height !== sourceCanvas.height) {
              target.width = sourceCanvas.width;
              target.height = sourceCanvas.height;
            }
            const tctx = target.getContext('2d');
            if (tctx) {
              tctx.drawImage(sourceCanvas, 0, 0);
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

        const item: CreationItem = {
          id: crypto.randomUUID(),
          kind: 'video',
          sourceMode: activeTab,
          prompt: trimmedPrompt,
          style: stylePreset,
          aspectRatio,
          width: result.width,
          height: result.height,
          duration,
          cameraMotion,
          quality,
          engineLabel:
            activeTab === 'text-to-video'
              ? `Pollinations AI ${quality}`
              : `CineGen ${quality} Animate`,
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
          ? quality === '1080p'
            ? { width: 1080, height: 1920 }
            : { width: 720, height: 1280 }
          : aspectRatio === '1:1'
          ? quality === '1080p'
            ? { width: 1080, height: 1080 }
            : { width: 720, height: 720 }
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
    setPendingImageJob(null);
    stopTimer();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsLivePreviewActive(false);
    setProgress({ active: false, percent: 0, statusMessage: '', elapsedSeconds: 0 });
    setActiveCreationId(null);
    setErrorMessage(null);
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
          setActiveTab(tab);
        }}
        creationsCount={creations.length}
        onResetWorkspace={handleResetWorkspace}
        strings={strings}
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
                pendingImageUrl={pendingImageJob?.url ?? null}
                pendingImageAlt={pendingImageJob?.prompt ?? ''}
                onPendingImageLoad={handlePendingImageLoad}
                onPendingImageError={handlePendingImageError}
                liveCanvasRef={liveCanvasRef}
                isLivePreviewActive={isLivePreviewActive}
                errorMessage={errorMessage}
                onDismissError={() => setErrorMessage(null)}
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

      <footer className="border-t border-white/[0.08] bg-[#07090E]/95">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:px-6 lg:px-8">
          <div className="font-display text-sm font-semibold tracking-tight text-slate-200">
            Jatt CineGen AI
          </div>
          <div className="flex items-center gap-3">
            <span>{strings.footerCredit}</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 font-medium text-cyan-200">
              <BadgeCheck className="h-3.5 w-3.5 text-cyan-400" />
              Creator · Jatt Official
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
