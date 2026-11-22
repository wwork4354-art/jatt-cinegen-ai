import { useState, type RefObject } from 'react';
import {
  Check,
  Download,
  Film,
  Image as ImageIcon,
  Maximize2,
  RotateCw,
  Share2,
  X,
} from 'lucide-react';
import type { UIStrings } from '../lib/i18n';
import {
  CAMERA_MOTIONS,
  STYLE_PRESETS,
  type AspectRatio,
  type CreationItem,
  type GenerationProgress,
  type StudioTab,
} from '../types/studio';

interface PreviewStageProps {
  mode: Exclude<StudioTab, 'creations'>;
  aspectRatio: AspectRatio;
  progress: GenerationProgress;
  activeCreation: CreationItem | null;
  pendingImageUrl: string | null;
  pendingImageAlt: string;
  onPendingImageLoad: () => void;
  onPendingImageError: () => void;
  liveCanvasRef: RefObject<HTMLCanvasElement | null>;
  isLivePreviewActive: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
  gpuBusyNotice: string | null;
  onDismissGpuBusy: () => void;
  onRetryHfGpu: () => void;
  onFallbackToReel: () => void;
  onDownload: (item: CreationItem) => void;
  onShare: (item: CreationItem) => void;
  onAnimateImage: (item: CreationItem) => void;
  strings: UIStrings;
}

export function PreviewStage({
  mode,
  aspectRatio,
  progress,
  activeCreation,
  pendingImageUrl,
  pendingImageAlt,
  onPendingImageLoad,
  onPendingImageError,
  liveCanvasRef,
  isLivePreviewActive,
  errorMessage,
  onDismissError,
  gpuBusyNotice,
  onDismissGpuBusy,
  onRetryHfGpu,
  onFallbackToReel,
  onDownload,
  onShare,
  onAnimateImage,
  strings,
}: PreviewStageProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const styleLabel =
    STYLE_PRESETS.find((s) => s.id === activeCreation?.style)?.label ?? 'Custom';
  const cameraLabel =
    CAMERA_MOTIONS.find((c) => c.id === activeCreation?.cameraMotion)?.label ?? '';

  const previewFrameClass =
    (activeCreation?.aspectRatio ?? aspectRatio) === '9:16'
      ? 'aspect-[9/16] max-h-[560px]'
      : (activeCreation?.aspectRatio ?? aspectRatio) === '1:1'
      ? 'aspect-square max-h-[540px]'
      : 'aspect-video w-full';

  return (
    <section
      aria-label="Generation preview viewport"
      className="flex flex-1 flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0D1118] p-4 sm:p-6"
    >
      {/* Hidden preloading image element for direct Pollinations URL onLoad detection */}
      {pendingImageUrl && (
        <img
          src={pendingImageUrl}
          alt={pendingImageAlt}
          referrerPolicy="no-referrer"
          onLoad={onPendingImageLoad}
          onError={onPendingImageError}
          className="fixed -left-[9999px] top-0 h-1 w-1 opacity-0 pointer-events-none"
        />
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-1 text-rose-300 hover:bg-rose-500/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Free GPU Busy Banner with One-Click Retry or Fast 3-Scene Reel Switch */}
      {gpuBusyNotice && !progress.active && (
        <div
          role="status"
          className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="font-semibold text-amber-200">
              Free GPU busy — retrying or switch to Fast 3-Scene Reel
            </div>
            <p className="text-xs text-amber-200/80 break-words">{gpuBusyNotice}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRetryHfGpu}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 transition-colors"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry Free AI GPU
            </button>
            <button
              type="button"
              onClick={onFallbackToReel}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
            >
              <Film className="h-3.5 w-3.5" />
              Switch to Fast 3-Scene Reel
            </button>
            <button
              type="button"
              onClick={onDismissGpuBusy}
              aria-label="Dismiss GPU queue notice"
              className="rounded p-1 text-amber-300 hover:bg-amber-400/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Darkroom Stage */}
      <div className="relative flex flex-1 flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#07090E] p-4 sm:p-6 min-h-[420px] lg:min-h-[560px]">
        {progress.active ? (
          isLivePreviewActive ? (
            <div className="flex w-full flex-col items-center gap-4">
              <div
                className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-cyan-400/35 bg-black ${
                  aspectRatio === '9:16'
                    ? 'aspect-[9/16] max-h-[480px]'
                    : aspectRatio === '1:1'
                    ? 'aspect-square max-h-[460px]'
                    : 'aspect-video w-full'
                }`}
              >
                <canvas
                  ref={liveCanvasRef}
                  className="h-full w-full object-contain"
                />
                <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/75 px-2.5 py-1 text-[11px] font-mono tabular-nums text-cyan-300 border border-white/10">
                  LIVE RENDER PREVIEW
                </div>
              </div>

              <div className="w-full max-w-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    {progress.statusMessage}
                  </span>
                  <span className="font-mono tabular-nums text-cyan-300">
                    {progress.percent}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-cyan-300 transition-all duration-200 ease-out shadow-[0_0_16px_rgba(34,211,238,0.65)]"
                    style={{ width: `${Math.max(4, progress.percent)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md space-y-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                {mode === 'text-to-image' ? (
                  <ImageIcon className="h-6 w-6" />
                ) : (
                  <Film className="h-6 w-6" />
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-white">
                  {progress.statusMessage}
                </div>
                <div className="flex items-center justify-center gap-3 text-xs font-mono tabular-nums text-slate-400">
                  <span>{progress.percent}%</span>
                  <span aria-hidden="true">·</span>
                  <span>{progress.elapsedSeconds.toFixed(1)}s elapsed</span>
                </div>
              </div>

              {/* Real-Time Progress Bar */}
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-cyan-300 transition-all duration-300 ease-out shadow-[0_0_16px_rgba(34,211,238,0.65)]"
                  style={{ width: `${Math.max(4, progress.percent)}%` }}
                />
              </div>
            </div>
          )
        ) : activeCreation ? (
          <div className="flex w-full flex-col items-center justify-center gap-4">
            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black ${previewFrameClass}`}
            >
              {activeCreation.kind === 'image' ? (
                <>
                  <img
                    src={activeCreation.mediaUrl}
                    alt={activeCreation.prompt}
                    referrerPolicy="no-referrer"
                    onClick={() => setIsLightboxOpen(true)}
                    className="h-full w-full cursor-zoom-in object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setIsLightboxOpen(true)}
                    aria-label="Inspect Full HD image"
                    className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-black/70 text-white hover:border-cyan-400 hover:text-cyan-200 transition-colors"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <video
                  key={activeCreation.id}
                  src={activeCreation.mediaUrl}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="h-full w-full object-contain"
                />
              )}
            </div>
          </div>
        ) : (
          /* Clean Empty Viewfinder */
          <div className="flex flex-col items-center justify-center text-center max-w-sm space-y-4">
            <div
              className={`flex items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-8 transition-all ${
                aspectRatio === '9:16'
                  ? 'h-48 w-28'
                  : aspectRatio === '1:1'
                  ? 'h-36 w-36'
                  : 'h-32 w-56'
              }`}
            >
              {mode === 'text-to-image' ? (
                <ImageIcon className="h-7 w-7 text-slate-600" />
              ) : (
                <Film className="h-7 w-7 text-slate-600" />
              )}
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-lg font-semibold text-slate-200">
                {mode === 'text-to-image'
                  ? strings.readyImageTitle
                  : strings.readyVideoTitle}
              </h2>
              <p className="text-xs leading-relaxed text-slate-500">
                {strings.readySubtitle}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Output Metadata + Action Controls */}
      {activeCreation && !progress.active && (
        <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
              <span className="inline-flex items-center gap-1 text-emerald-400 font-sans font-medium">
                <Check className="h-3.5 w-3.5" />
                Saved to {strings.navMyCreations}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {activeCreation.width} × {activeCreation.height}
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeCreation.aspectRatio}</span>
              <span aria-hidden="true">·</span>
              <span>{styleLabel}</span>
              {activeCreation.duration && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{activeCreation.duration}</span>
                </>
              )}
              {cameraLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{cameraLabel}</span>
                </>
              )}
            </div>
            <p className="truncate text-sm text-slate-200 max-w-xl">
              {activeCreation.prompt}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {activeCreation.kind === 'image' && (
              <button
                type="button"
                onClick={() => onAnimateImage(activeCreation)}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 whitespace-nowrap hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
              >
                <Film className="h-3.5 w-3.5" />
                {strings.animateImageBtn}
              </button>
            )}

            <button
              type="button"
              onClick={() => onShare(activeCreation)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 whitespace-nowrap hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" />
              {strings.shareBtn}
            </button>

            <button
              type="button"
              onClick={() => onDownload(activeCreation)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 whitespace-nowrap hover:bg-cyan-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <Download className="h-3.5 w-3.5" />
              {activeCreation.kind === 'video'
                ? activeCreation.mimeType.includes('mp4')
                  ? 'Download MP4'
                  : strings.downloadVideoBtn
                : strings.downloadImageBtn}
            </button>
          </div>
        </div>
      )}

      {activeCreation?.scenes && activeCreation.scenes.length > 0 && !progress.active && (
        <div
          className={`mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-4 ${
            activeCreation.scenes.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
          }`}
        >
          {activeCreation.scenes.map((sceneText, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-white/[0.06] bg-[#07090E]/70 p-3 space-y-1"
            >
              <div className="text-[11px] font-mono tabular-nums text-cyan-300">
                Keyframe 0{idx + 1} ·{' '}
                {idx === 0
                  ? 'Opening Act'
                  : activeCreation.scenes!.length === 2
                  ? 'Action & Finale'
                  : idx === 1
                  ? 'Action & Motion'
                  : 'Closing Resolve'}
              </div>
              <p className="text-xs leading-relaxed text-slate-300 line-clamp-2">
                {sceneText}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {isLightboxOpen && activeCreation?.kind === 'image' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full resolution image preview"
          onClick={() => setIsLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setIsLightboxOpen(false)}
            aria-label="Close preview"
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/80 text-white hover:border-cyan-400"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={activeCreation.mediaUrl}
            alt={activeCreation.prompt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[92vw] rounded-xl border border-white/10 object-contain"
          />
        </div>
      )}
    </section>
  );
}
