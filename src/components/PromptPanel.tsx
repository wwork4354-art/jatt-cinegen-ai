import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Clock,
  Globe,
  ImagePlus,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Music,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { LANGUAGES, type LanguageCode, type UIStrings } from '../lib/i18n';
import {
  getVoiceLanguageById,
  MORE_VOICE_LANGUAGES,
  QUICK_VOICE_LANGUAGES,
} from '../lib/voiceLanguages';
import {
  CAMERA_MOTIONS,
  STYLE_PRESETS,
  type AspectRatio,
  type CameraMotionId,
  type CreationItem,
  type StudioTab,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
  type VideoSourceMode,
} from '../types/studio';

interface PromptPanelProps {
  mode: Exclude<StudioTab, 'creations'>;
  language: LanguageCode;
  onLanguageChange: (code: LanguageCode) => void;
  voiceLanguageId: string;
  onVoiceLanguageChange: (id: string) => void;
  strings: UIStrings;
  prompt: string;
  onPromptChange: (value: string) => void;
  previousPrompt: string | null;
  onUndoEnhance: () => void;
  onEnhancePrompt: () => Promise<void>;
  isEnhancing: boolean;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  stylePreset: StylePresetId;
  onStylePresetChange: (style: StylePresetId) => void;
  duration: VideoDuration;
  onDurationChange: (duration: VideoDuration) => void;
  cameraMotion: CameraMotionId;
  onCameraMotionChange: (motion: CameraMotionId) => void;
  quality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
  voiceoverEnabled: boolean;
  onVoiceoverChange: (enabled: boolean) => void;
  backgroundMusicFile: File | null;
  onBackgroundMusicChange: (file: File | null) => void;
  videoSourceMode: VideoSourceMode;
  onVideoSourceModeChange: (mode: VideoSourceMode) => void;
  customBackendUrl: string;
  onCustomBackendUrlChange: (url: string) => void;
  uploadedImageUrl: string | null;
  onUploadedImageChange: (dataUrl: string | null) => void;
  recentImages: CreationItem[];
  isGenerating: boolean;
  onGenerate: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SAMPLE_PROMPTS: Record<Exclude<StudioTab, 'creations'>, string[]> = {
  'text-to-video': [
    'A majestic lion walking in a glowing cyberpunk jungle at sunset',
    'Slow aerial reveal over volcanic black sand beaches with rolling surf',
    'High-speed magnetic train gliding across an alpine viaduct at twilight',
  ],
  'image-to-video': [
    'Gentle wind ripples across the scene while warm ambient light slowly shifts',
    'Subtle cinematic dolly push-in with drifting atmospheric dust motes',
    'Camera slowly pans right as reflections shimmer across the foreground',
  ],
  'text-to-image': [
    'Obsidian glass pavilion perched above misty basalt sea cliffs at blue hour',
    'Bioluminescent deep-sea jellyfish drifting through dark indigo ocean abyss',
    'Futuristic Kyoto tramway crossing a rain-drenched lantern bridge at dusk',
  ],
};

export function PromptPanel({
  mode,
  language,
  onLanguageChange,
  voiceLanguageId,
  onVoiceLanguageChange,
  strings,
  prompt,
  onPromptChange,
  previousPrompt,
  onUndoEnhance,
  onEnhancePrompt,
  isEnhancing,
  aspectRatio,
  onAspectRatioChange,
  stylePreset,
  onStylePresetChange,
  duration,
  onDurationChange,
  cameraMotion,
  onCameraMotionChange,
  quality,
  onQualityChange,
  voiceoverEnabled,
  onVoiceoverChange,
  backgroundMusicFile,
  onBackgroundMusicChange,
  videoSourceMode,
  onVideoSourceModeChange,
  customBackendUrl,
  onCustomBackendUrlChange,
  uploadedImageUrl,
  onUploadedImageChange,
  recentImages,
  isGenerating,
  onGenerate,
}: PromptPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceStatusNote, setVoiceStatusNote] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<{
    checking: boolean;
    ok?: boolean;
    message?: string;
  }>({ checking: false });

  useEffect(() => {
    if (language === 'ur') onVoiceLanguageChange('ur');
    else if (language === 'pa') onVoiceLanguageChange('pa');
    else if (language === 'hi') onVoiceLanguageChange('hi');
    else if (language === 'ar') onVoiceLanguageChange('ar');
    else if (language === 'ru') onVoiceLanguageChange('ru');
    else if (language === 'zh') onVoiceLanguageChange('zh');
    else if (language === 'en') onVoiceLanguageChange('en');
  }, [language, onVoiceLanguageChange]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  const activeVoiceLang = getVoiceLanguageById(voiceLanguageId);
  const isMoreLanguageSelected = !activeVoiceLang.isQuickPill;

  const startRecognitionWithCodes = (
    SpeechRecCtor: new () => SpeechRecognitionInstanceLike,
    codeQueue: string[],
    queueIndex: number
  ) => {
    const activeCode = codeQueue[queueIndex];
    if (!activeCode) {
      setVoiceError(`Speech recognition is unavailable for ${activeVoiceLang.englishName} on this browser.`);
      setIsListening(false);
      return;
    }

    let retryingFallback = false;
    try {
      const recognition = new SpeechRecCtor();
      recognition.lang = activeCode;
      recognition.continuous = true;
      recognition.interimResults = true;

      if (queueIndex > 0) {
        setVoiceStatusNote(
          `Listening with ${activeCode} speech engine for ${activeVoiceLang.nativeLabel}`
        );
      } else {
        setVoiceStatusNote(
          activeVoiceLang.id !== 'en'
            ? `Speak in ${activeVoiceLang.englishName} — auto-translates to English for AI scenes`
            : null
        );
      }

      recognition.onresult = (event) => {
        let finalChunk = '';
        let interimChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalChunk += text;
          } else {
            interimChunk += text;
          }
        }
        if (finalChunk.trim()) {
          const current = promptRef.current.trim();
          const appended = current ? `${current} ${finalChunk.trim()}` : finalChunk.trim();
          onPromptChange(appended);
        }
        setInterimTranscript(interimChunk.trim());
      };

      recognition.onerror = (event) => {
        if (event.error === 'language-not-supported' && queueIndex + 1 < codeQueue.length) {
          retryingFallback = true;
          try {
            recognition.stop();
          } catch {
            // Ignore stop error before fallback retry
          }
          startRecognitionWithCodes(SpeechRecCtor, codeQueue, queueIndex + 1);
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setVoiceError('Microphone access denied. Please allow microphone permission.');
        } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
          setVoiceError(`Voice recognition error: ${event.error}`);
        }
        setIsListening(false);
        setInterimTranscript('');
      };

      recognition.onend = () => {
        if (retryingFallback) return;
        setIsListening(false);
        setInterimTranscript('');
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      if (queueIndex + 1 < codeQueue.length) {
        startRecognitionWithCodes(SpeechRecCtor, codeQueue, queueIndex + 1);
      } else {
        setVoiceError('Could not start voice recognition on this device.');
        setIsListening(false);
      }
    }
  };

  const toggleVoiceInput = () => {
    setVoiceError(null);
    setVoiceStatusNote(null);
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      setIsListening(false);
      setInterimTranscript('');
      return;
    }

    const SpeechRecCtor =
      (
        window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
          webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      setVoiceError('Voice input requires Chrome, Edge, or Safari SpeechRecognition support.');
      return;
    }

    const codeQueue = [activeVoiceLang.speechCode, ...activeVoiceLang.fallbackCodes];
    startRecognitionWithCodes(SpeechRecCtor, codeQueue, 0);
  };

  const isVideoMode = mode === 'text-to-video' || mode === 'image-to-video';
  const aspectOptions: AspectRatio[] = ['16:9', '9:16', '1:1'];

  const handleFileRead = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadedImageChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTestBackend = async () => {
    if (!customBackendUrl.trim()) {
      setBackendStatus({ checking: false, ok: false, message: 'Enter an endpoint URL first.' });
      return;
    }
    setBackendStatus({ checking: true });
    try {
      const res = await fetch('/api/check-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: customBackendUrl.trim() }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Backend proxy is unavailable in this environment.');
      }
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setBackendStatus({
        checking: false,
        ok: Boolean(data.ok),
        message: data.message || data.error || 'Checked endpoint.',
      });
    } catch {
      setBackendStatus({
        checking: false,
        ok: false,
        message: 'Could not reach backend proxy.',
      });
    }
  };

  const canGenerate =
    !isGenerating &&
    prompt.trim().length > 0 &&
    (mode !== 'image-to-video' || Boolean(uploadedImageUrl)) &&
    (!isVideoMode || videoSourceMode === 'demo' || customBackendUrl.trim().length > 0);

  const heading =
    mode === 'text-to-image'
      ? strings.navTextToImage
      : mode === 'text-to-video'
      ? strings.navTextToVideo
      : strings.navImageToVideo;

  const subtitle =
    mode === 'text-to-image'
      ? 'Generate Full HD images 100% free via Pollinations AI with zero key limits.'
      : mode === 'text-to-video'
      ? 'Auto-generates sequential Pollinations AI scenes and renders a continuous 15s video in-browser.'
      : 'Upload any photo and animate it with smooth camera motion and optional audio.';

  return (
    <section
      aria-label="Generation controls"
      className="flex flex-col gap-5 rounded-2xl border border-white/[0.08] bg-[#0D1118] p-4 sm:p-6"
    >
      {/* Header + 13-Language Selector */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            {heading}
          </h1>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-400">{subtitle}</p>
        </div>

        <div className="shrink-0">
          <label htmlFor="studio-language" className="sr-only">
            {strings.languageLabel}
          </label>
          <div className="relative flex items-center">
            <Globe className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-cyan-400" />
            <select
              id="studio-language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
              className="min-h-[36px] appearance-none rounded-lg border border-white/15 bg-[#07090E] pl-8 pr-6 py-1.5 text-xs font-medium text-slate-200 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Image Uploader for Image to Video */}
      {mode === 'image-to-video' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold tracking-wide text-slate-300">
              Reference Image
            </label>
            {uploadedImageUrl && (
              <button
                type="button"
                onClick={() => onUploadedImageChange(null)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-rose-300 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {strings.musicRemove}
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileRead(file);
              e.target.value = '';
            }}
          />

          {uploadedImageUrl ? (
            <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-[#07090E]">
              <img
                src={uploadedImageUrl}
                alt="Uploaded reference frame"
                className="h-44 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3">
                <span className="text-xs font-medium text-slate-200">
                  Source frame ready
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white hover:border-cyan-400/60 hover:text-cyan-200 transition-colors"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileRead(file);
              }}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-400/10'
                  : 'border-white/15 bg-[#07090E]/60 hover:border-cyan-400/50 hover:bg-white/[0.02]'
              }`}
            >
              <Upload className="h-5 w-5 text-cyan-400" />
              <div className="text-sm font-medium text-slate-200">
                Drop an image here or click to browse
              </div>
              <div className="text-xs text-slate-500">PNG, JPG, or WebP</div>
            </button>
          )}

          {recentImages.length > 0 && !uploadedImageUrl && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-400">
                Or pick from {strings.navMyCreations}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {recentImages.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onUploadedImageChange(item.mediaUrl)}
                    title={item.prompt}
                    className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 hover:border-cyan-400 transition-colors"
                  >
                    <img
                      src={item.mediaUrl}
                      alt={item.prompt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Prompt Input + Magic Enhance */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="studio-prompt"
            className="text-xs font-semibold tracking-wide text-slate-300"
          >
            {strings.promptLabel}
          </label>
          <div className="flex items-center gap-2">
            {previousPrompt && (
              <button
                type="button"
                onClick={onUndoEnhance}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-100 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={onEnhancePrompt}
              disabled={isEnhancing || !prompt.trim()}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {isEnhancing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {isEnhancing ? strings.enhancing : strings.magicEnhance}
            </button>
          </div>
        </div>

        <div
          className={`relative rounded-xl border bg-[#07090E] transition-colors ${
            isListening
              ? 'border-cyan-400 ring-2 ring-cyan-400/25'
              : 'border-white/10 focus-within:border-cyan-400/70 focus-within:ring-2 focus-within:ring-cyan-400/25'
          }`}
        >
          <textarea
            id="studio-prompt"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={4}
            placeholder={
              mode === 'image-to-video'
                ? strings.promptPlaceholderAnimate
                : mode === 'text-to-video'
                ? strings.promptPlaceholderVideo
                : strings.promptPlaceholderImage
            }
            className="w-full resize-y rounded-t-xl bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />

          <div className="flex flex-col gap-2 border-t border-white/[0.06] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Voice input languages">
              {QUICK_VOICE_LANGUAGES.map((vLang) => {
                const selected = voiceLanguageId === vLang.id;
                return (
                  <button
                    key={vLang.id}
                    type="button"
                    onClick={() => onVoiceLanguageChange(vLang.id)}
                    title={`${vLang.englishName} (${vLang.speechCode})`}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      selected
                        ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/45'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {vLang.nativeLabel}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex items-center">
                <label htmlFor="voice-more-languages" className="sr-only">
                  More voice input languages
                </label>
                <select
                  id="voice-more-languages"
                  value={isMoreLanguageSelected ? voiceLanguageId : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      onVoiceLanguageChange(e.target.value);
                    }
                  }}
                  aria-label="More voice input languages"
                  className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors focus:border-cyan-400 focus:outline-none ${
                    isMoreLanguageSelected
                      ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-[#0D1118] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <option value="" disabled>
                    + More Languages
                  </option>
                  {MORE_VOICE_LANGUAGES.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.nativeLabel} — {lang.englishName}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={toggleVoiceInput}
                aria-pressed={isListening}
                aria-label={isListening ? 'Stop voice input' : 'Speak prompt with microphone'}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                  isListening
                    ? 'border border-rose-400/70 bg-rose-500/20 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.45)]'
                    : 'border border-cyan-400/50 bg-cyan-400/15 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.35)] hover:bg-cyan-400/25 hover:shadow-[0_0_24px_rgba(34,211,238,0.55)]'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="h-3.5 w-3.5 text-rose-300" />
                    <span>Listening ({activeVoiceLang.nativeLabel})...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5 text-cyan-300" />
                    <span>Voice Input ({activeVoiceLang.nativeLabel})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {(interimTranscript || voiceStatusNote || voiceError) && (
          <div className="space-y-0.5 text-xs px-1">
            {interimTranscript && (
              <p className="text-cyan-300/90 italic">Hearing: “{interimTranscript}”</p>
            )}
            {voiceStatusNote && !voiceError && (
              <p className="text-slate-400 text-[11px]">{voiceStatusNote}</p>
            )}
            {voiceError && <p className="text-amber-300">{voiceError}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500">Try:</span>
            {SAMPLE_PROMPTS[mode].map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onPromptChange(sample)}
                className="rounded-md bg-white/[0.04] px-2 py-1 text-left text-xs text-slate-300 hover:bg-white/[0.08] hover:text-cyan-200 transition-colors truncate max-w-[165px]"
              >
                {sample}
              </button>
            ))}
          </div>
          <span className="font-mono tabular-nums text-slate-500">
            {prompt.length} chars
          </span>
        </div>
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-2.5">
        <span className="block text-xs font-semibold tracking-wide text-slate-300">
          {strings.aspectRatio}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {aspectOptions.map((ratio) => {
            const active = aspectRatio === ratio;
            const label =
              ratio === '16:9'
                ? strings.ratioWide
                : ratio === '9:16'
                ? strings.ratioVertical
                : strings.ratioSquare;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => onAspectRatioChange(ratio)}
                className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  active
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/10 bg-[#07090E]/70 text-slate-400 hover:border-white/25 hover:text-slate-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block shrink-0 rounded-[2px] border ${
                    active ? 'border-cyan-300' : 'border-slate-500'
                  } ${
                    ratio === '16:9'
                      ? 'h-2.5 w-4'
                      : ratio === '9:16'
                      ? 'h-4 w-2.5'
                      : 'h-3.5 w-3.5'
                  }`}
                />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Style Presets */}
      <div className="space-y-2.5">
        <span className="block text-xs font-semibold tracking-wide text-slate-300">
          {strings.stylePreset}
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STYLE_PRESETS.map((preset) => {
            const active = stylePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onStylePresetChange(preset.id)}
                className={`group relative flex h-18 flex-col justify-end overflow-hidden rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  active
                    ? 'border-cyan-400 ring-1 ring-cyan-400/50'
                    : 'border-white/10 hover:border-white/25'
                }`}
              >
                {preset.thumbnail ? (
                  <>
                    <img
                      src={preset.thumbnail}
                      alt={preset.label}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/15" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-[#121722]" />
                )}

                <div className="relative z-10 flex items-center justify-between gap-1">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {preset.label}
                    </div>
                    <div className="text-[11px] text-slate-300/90 truncate max-w-[115px]">
                      {preset.description}
                    </div>
                  </div>
                  {active && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Video-specific Controls */}
      {isVideoMode && (
        <div className="space-y-4 border-t border-white/[0.08] pt-4">
          {/* Duration */}
          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              {strings.duration}
            </span>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-[#07090E] p-1">
              {(['5s', '10s', '15s'] as VideoDuration[]).map((dur) => (
                <button
                  key={dur}
                  type="button"
                  onClick={() => onDurationChange(dur)}
                  className={`min-h-[36px] rounded-lg text-xs font-semibold font-mono tabular-nums transition-colors ${
                    duration === dur
                      ? 'bg-cyan-400/20 text-cyan-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dur}
                </button>
              ))}
            </div>
            {mode === 'text-to-video' && duration === '15s' && (
              <p className="text-[11px] leading-snug text-cyan-300/80">
                Generates 3 sequential Pollinations AI scenes and stitches a 15s video.
              </p>
            )}
          </div>

          {/* 4K / HD Quality Export Selector */}
          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
              {strings.renderQuality}
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => onQualityChange('720p')}
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  quality === '720p'
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
                }`}
              >
                <span className="text-xs font-semibold whitespace-nowrap">Fast 720p</span>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">3GB RAM Friendly</span>
              </button>

              <button
                type="button"
                onClick={() => onQualityChange('1080p')}
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  quality === '1080p'
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
                }`}
              >
                <span className="text-xs font-semibold whitespace-nowrap">{strings.fullHdMode}</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">1920×1080</span>
              </button>

              <button
                type="button"
                onClick={() => onQualityChange('4k')}
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  quality === '4k'
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
                }`}
              >
                <span className="text-xs font-semibold whitespace-nowrap">{strings.ultraHd}</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">3840×2160</span>
              </button>
            </div>
          </div>

          {/* Camera Motion Controls */}
          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300">
              <Camera className="h-3.5 w-3.5 text-slate-400" />
              {strings.cameraMotion}
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CAMERA_MOTIONS.map((motion) => {
                const active = cameraMotion === motion.id;
                return (
                  <button
                    key={motion.id}
                    type="button"
                    onClick={() => onCameraMotionChange(motion.id)}
                    title={motion.hint}
                    className={`min-h-[38px] rounded-xl border px-3 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                      active
                        ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                        : 'border-white/10 bg-[#07090E]/70 text-slate-400 hover:border-white/25 hover:text-slate-200'
                    }`}
                  >
                    <div className="truncate font-semibold">{motion.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Voiceover & Background Music Audio Controls */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              role="switch"
              aria-checked={voiceoverEnabled}
              onClick={() => onVoiceoverChange(!voiceoverEnabled)}
              title={strings.voiceoverHint}
              className={`flex min-h-[44px] items-center justify-between rounded-xl border px-3.5 py-2 text-left transition-colors ${
                voiceoverEnabled
                  ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200'
                  : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold truncate">
                <Mic className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <span className="truncate">{strings.voiceoverLabel}</span>
              </span>
              <span
                aria-hidden="true"
                className={`relative ml-2 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  voiceoverEnabled ? 'bg-cyan-400' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-slate-950 transition-transform ${
                    voiceoverEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>

            <div>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  onBackgroundMusicChange(file);
                  e.target.value = '';
                }}
              />
              {backgroundMusicFile ? (
                <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-cyan-400/50 bg-cyan-400/10 px-3 py-2">
                  <span className="flex items-center gap-2 text-xs font-medium text-cyan-200 truncate">
                    <Music className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{backgroundMusicFile.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onBackgroundMusicChange(null)}
                    className="text-[11px] font-semibold text-rose-300 hover:text-rose-200 shrink-0"
                  >
                    {strings.musicRemove}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#07090E]/75 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
                >
                  <Music className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="truncate">{strings.musicUpload}</span>
                </button>
              )}
            </div>
          </div>

          {/* Optional Advanced Custom Backend Toggle */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-[#07090E]/75 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold tracking-wide text-slate-200">
                  {videoSourceMode === 'demo'
                    ? 'Free Unlimited Pollinations Engine (Active)'
                    : 'Custom Backend API (Active)'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Works 100% free with zero API keys or credit limits.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onVideoSourceModeChange(
                    videoSourceMode === 'demo' ? 'custom-backend' : 'demo'
                  )
                }
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  videoSourceMode === 'custom-backend'
                    ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                    : 'border-white/10 bg-[#0D1118] text-slate-300 hover:border-white/25'
                }`}
              >
                {videoSourceMode === 'custom-backend'
                  ? 'Use Free Default'
                  : 'Custom Backend URL'}
              </button>
            </div>

            {videoSourceMode === 'custom-backend' && (
              <div className="space-y-2 border-t border-white/[0.08] pt-3">
                <label
                  htmlFor="custom-backend-url"
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400"
                >
                  <Link2 className="h-3.5 w-3.5 text-cyan-400" />
                  Custom Backend URL (Google Colab / Hugging Face / FastAPI)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="custom-backend-url"
                    type="url"
                    value={customBackendUrl}
                    onChange={(e) => {
                      onCustomBackendUrlChange(e.target.value);
                      setBackendStatus({ checking: false });
                    }}
                    placeholder="https://your-colab-tunnel.trycloudflare.com/generate"
                    className="min-h-[40px] flex-1 rounded-lg border border-white/10 bg-[#0D1118] px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                  />
                  <button
                    type="button"
                    onClick={handleTestBackend}
                    disabled={backendStatus.checking || !customBackendUrl.trim()}
                    className="min-h-[40px] rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 whitespace-nowrap hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-40 transition-colors"
                  >
                    {backendStatus.checking ? 'Testing...' : 'Test URL'}
                  </button>
                </div>

                {backendStatus.message && (
                  <p
                    className={`text-xs ${
                      backendStatus.ok ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {backendStatus.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary Generate Button */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.28)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1118]"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {strings.generatingBtn}
          </>
        ) : mode === 'text-to-image' ? (
          <>
            <ImagePlus className="h-4 w-4" />
            {strings.generateImageBtn}
          </>
        ) : mode === 'text-to-video' ? (
          videoSourceMode === 'demo' ? (
            strings.generateVideoBtn
          ) : (
            'Generate Video via Custom URL'
          )
        ) : videoSourceMode === 'demo' ? (
          strings.animateBtn
        ) : (
          'Animate via Custom URL'
        )}
      </button>
    </section>
  );
}
