import {
  Camera,
  Check,
  Clock,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  SlidersHorizontal,
  Sparkles,
  Type,
  Wand2,
} from 'lucide-react';
import {
  LIFETIME_PROMPT_PRESETS,
  type LifetimePromptPreset,
} from '../lib/lifetimeFreeEngine';
import {
  CAMERA_MOTIONS,
  STYLE_PRESETS,
  type AspectRatio,
  type CameraMotionId,
  type LifetimeCaptionStyle,
  type LifetimeKeyframeSource,
  type LifetimeParticleStyle,
  type LifetimeSoundtrackMood,
  type LifetimeStudioSubTab,
  type StylePresetId,
  type VideoDuration,
  type VideoQuality,
} from '../types/studio';

interface JattLifetimeStudioProps {
  subTab: LifetimeStudioSubTab;
  onSubTabChange: (tab: LifetimeStudioSubTab) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  captionText: string;
  onCaptionTextChange: (value: string) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  stylePreset: StylePresetId;
  onStylePresetChange: (style: StylePresetId) => void;
  duration: VideoDuration;
  onDurationChange: (duration: VideoDuration) => void;
  quality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
  cameraMotion: CameraMotionId;
  onCameraMotionChange: (motion: CameraMotionId) => void;
  particleStyle: LifetimeParticleStyle;
  onParticleStyleChange: (style: LifetimeParticleStyle) => void;
  captionStyle: LifetimeCaptionStyle;
  onCaptionStyleChange: (style: LifetimeCaptionStyle) => void;
  soundtrackMood: LifetimeSoundtrackMood;
  onSoundtrackMoodChange: (mood: LifetimeSoundtrackMood) => void;
  keyframeSource: LifetimeKeyframeSource;
  onKeyframeSourceChange: (source: LifetimeKeyframeSource) => void;
  offlineImageMode: boolean;
  onOfflineImageModeChange: (offline: boolean) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}

export function JattLifetimeStudio({
  subTab,
  onSubTabChange,
  prompt,
  onPromptChange,
  captionText,
  onCaptionTextChange,
  aspectRatio,
  onAspectRatioChange,
  stylePreset,
  onStylePresetChange,
  duration,
  onDurationChange,
  quality,
  onQualityChange,
  cameraMotion,
  onCameraMotionChange,
  particleStyle,
  onParticleStyleChange,
  captionStyle,
  onCaptionStyleChange,
  soundtrackMood,
  onSoundtrackMoodChange,
  keyframeSource,
  onKeyframeSourceChange,
  offlineImageMode,
  onOfflineImageModeChange,
  isGenerating,
  onGenerate,
}: JattLifetimeStudioProps) {
  const aspectOptions: { id: AspectRatio; label: string }[] = [
    { id: '16:9', label: '16:9 YouTube' },
    { id: '9:16', label: '9:16 Reels' },
    { id: '1:1', label: '1:1 Square' },
  ];

  const handleApplyPreset = (preset: LifetimePromptPreset) => {
    onPromptChange(preset.prompt);
    onCaptionTextChange(preset.caption);
    onStylePresetChange(preset.style);
    onParticleStyleChange(preset.particleStyle);
    onSoundtrackMoodChange(preset.soundtrackMood);
  };

  return (
    <section
      aria-label="Jatt AI Studio 100% Lifetime Free Engine"
      className="flex h-full flex-col justify-between gap-5 rounded-2xl border border-white/[0.08] bg-[#0D1118] p-4 sm:p-6"
    >
      <div className="space-y-5">
        {/* Module Header */}
        <div className="space-y-1.5 border-b border-white/[0.08] pb-4">
          <h1 className="font-display text-xl font-bold tracking-tight text-white">
            Jatt AI Studio (100% Lifetime Free Engine)
          </h1>
          <p className="text-xs leading-relaxed text-slate-400">
            Zero API keys · Zero login · Zero server cost forever. Keyless Pollinations URLs for free images + 100% browser-native Canvas, MediaRecorder &amp; Web Audio synthesis for video.
          </p>
        </div>

        {/* Generate Image / Generate Video Tabs */}
        <div
          role="tablist"
          aria-label="Lifetime Free Studio modes"
          className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-[#07090E] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'generate-image'}
            onClick={() => onSubTabChange('generate-image')}
            className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subTab === 'generate-image'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <span>Generate Image</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'generate-video'}
            onClick={() => onSubTabChange('generate-video')}
            className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subTab === 'generate-video'
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Film className="h-3.5 w-3.5 shrink-0" />
            <span>Generate Video</span>
          </button>
        </div>

        {/* Creative Prompt Presets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300">
              <Wand2 className="h-3.5 w-3.5 text-cyan-400" />
              Creative Prompt Presets
            </span>
            <span className="text-[11px] text-slate-500">One-click fill</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {LIFETIME_PROMPT_PRESETS.map((preset) => {
              const isSelected = prompt.trim() === preset.prompt.trim();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25 hover:text-white'
                  }`}
                >
                  <span className="w-full truncate text-xs font-semibold">{preset.title}</span>
                  <span className="w-full truncate text-[10px] text-slate-400">
                    {preset.category}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="lifetime-studio-prompt"
              className="text-xs font-semibold tracking-wide text-slate-300"
            >
              Scene Prompt
            </label>
            <span className="font-mono text-[11px] tabular-nums text-slate-500">
              {prompt.length} chars
            </span>
          </div>
          <textarea
            id="lifetime-studio-prompt"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={3}
            placeholder={
              subTab === 'generate-image'
                ? 'Describe any scene, portrait, cyberpunk city, or heritage landscape (zero API keys needed)...'
                : 'Describe your video scene — rendered with AI keyframes, Ken Burns motion, neon particles & Web Audio...'
            }
            className="w-full resize-y rounded-xl border border-white/10 bg-[#07090E] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
          />
        </div>

        {/* Aspect Ratio Options */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold tracking-wide text-slate-300">
            Aspect Ratio
          </span>
          <div className="grid grid-cols-3 gap-2">
            {aspectOptions.map((opt) => {
              const active = aspectRatio === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onAspectRatioChange(opt.id)}
                  className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
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
                      opt.id === '16:9'
                        ? 'h-2.5 w-4'
                        : opt.id === '9:16'
                        ? 'h-4 w-2.5'
                        : 'h-3.5 w-3.5'
                    }`}
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Style Preset */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold tracking-wide text-slate-300">
            Visual Style
          </span>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {STYLE_PRESETS.map((preset) => {
              const active = stylePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onStylePresetChange(preset.id)}
                  className={`flex min-h-[36px] items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-[#07090E]/75 text-slate-400 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  {active && <Check className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mode-specific Controls */}
        {subTab === 'generate-image' ? (
          <div className="space-y-3 border-t border-white/[0.08] pt-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#07090E]/75 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-200">
                  Pure Offline Canvas Mode
                </div>
                <div className="text-[11px] text-slate-400">
                  Off = keyless Pollinations AI with auto-retries &amp; offline fallback
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={offlineImageMode}
                onClick={() => onOfflineImageModeChange(!offlineImageMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  offlineImageMode ? 'bg-cyan-400' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-slate-950 transition-transform ${
                    offlineImageMode ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 border-t border-white/[0.08] pt-4">
            {/* Keyframe Source */}
            <div className="space-y-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-300">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                Keyframe Source
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onKeyframeSourceChange('ai-pollinations')}
                  className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors ${
                    keyframeSource === 'ai-pollinations'
                      ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span className="text-xs font-semibold">Keyless AI Keyframes</span>
                  <span className="text-[10px] text-slate-400">Pollinations + Offline Backup</span>
                </button>
                <button
                  type="button"
                  onClick={() => onKeyframeSourceChange('offline-procedural')}
                  className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors ${
                    keyframeSource === 'offline-procedural'
                      ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-[#07090E]/75 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span className="text-xs font-semibold">100% Offline Synth</span>
                  <span className="text-[10px] text-slate-400">Instant Zero-Network Canvas</span>
                </button>
              </div>
            </div>

            {/* Duration & HD Quality */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  Duration
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#07090E] p-1">
                  {(['5s', '10s', '15s'] as VideoDuration[]).map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => onDurationChange(dur)}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors ${
                        duration === dur
                          ? 'bg-cyan-400/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {dur}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                  Resolution
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#07090E] p-1">
                  {(['720p', '1080p'] as VideoQuality[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onQualityChange(q)}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors ${
                        quality === q || (q === '1080p' && quality === '4k')
                          ? 'bg-cyan-400/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Ken Burns Camera Motion */}
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Camera className="h-3.5 w-3.5 text-slate-400" />
                Ken Burns Camera Motion
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {CAMERA_MOTIONS.map((motion) => (
                  <button
                    key={motion.id}
                    type="button"
                    onClick={() => onCameraMotionChange(motion.id)}
                    className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-left text-[11px] font-semibold truncate transition-colors ${
                      cameraMotion === motion.id
                        ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                        : 'border-white/10 bg-[#07090E]/75 text-slate-400 hover:border-white/25 hover:text-slate-200'
                    }`}
                  >
                    {motion.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Neon Particle Overlay */}
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                Neon Particle Overlay
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(
                  [
                    { id: 'cyber-dust', label: 'Cyber Dust' },
                    { id: 'golden-embers', label: 'Gold Embers' },
                    { id: 'starlight', label: 'Starlight' },
                    { id: 'none', label: 'Off' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onParticleStyleChange(item.id)}
                    className={`min-h-[34px] rounded-lg border px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      particleStyle === item.id
                        ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                        : 'border-white/10 bg-[#07090E]/75 text-slate-400 hover:border-white/25 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Animated Caption & Web Audio Synth */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="lifetime-caption-text"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
                >
                  <Type className="h-3.5 w-3.5 text-slate-400" />
                  Animated Title / Caption
                </label>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'cinema-fade', label: 'Fade' },
                      { id: 'typewriter', label: 'Type' },
                      { id: 'neon-bar', label: 'Neon' },
                      { id: 'none', label: 'Off' },
                    ] as const
                  ).map((cap) => (
                    <button
                      key={cap.id}
                      type="button"
                      onClick={() => onCaptionStyleChange(cap.id)}
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        captionStyle === cap.id
                          ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                          : 'text-slate-400 hover:text-slate-200 border border-white/10'
                      }`}
                    >
                      {cap.label}
                    </button>
                  ))}
                </div>
              </div>
              {captionStyle !== 'none' && (
                <input
                  id="lifetime-caption-text"
                  type="text"
                  value={captionText}
                  onChange={(e) => onCaptionTextChange(e.target.value)}
                  placeholder="Optional animated caption overlay (e.g. MIDNIGHT IN NEO TOKYO)"
                  className="min-h-[38px] w-full rounded-xl border border-white/10 bg-[#07090E] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                />
              )}
            </div>

            {/* Web Audio Synth Soundtrack */}
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Music className="h-3.5 w-3.5 text-cyan-400" />
                Web Audio Synth Soundtrack (100% Offline)
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(
                  [
                    { id: 'ambient-pad', label: 'Ambient Pad' },
                    { id: 'warm-horizon', label: 'Warm Horizon' },
                    { id: 'cyber-pulse', label: 'Cyber Pulse' },
                    { id: 'silent', label: 'Silent' },
                  ] as const
                ).map((mood) => (
                  <button
                    key={mood.id}
                    type="button"
                    onClick={() => onSoundtrackMoodChange(mood.id)}
                    className={`min-h-[34px] rounded-lg border px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      soundtrackMood === mood.id
                        ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                        : 'border-white/10 bg-[#07090E]/75 text-slate-400 hover:border-white/25 hover:text-slate-200'
                    }`}
                  >
                    {mood.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Primary Zero-Cost Generate CTA */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating || !prompt.trim()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.28)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1118]"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Rendering Free Creation...</span>
          </>
        ) : subTab === 'generate-image' ? (
          <>
            <ImageIcon className="h-4 w-4" />
            <span>Generate Free Image (Zero Keys)</span>
          </>
        ) : (
          <>
            <Film className="h-4 w-4" />
            <span>Render Free Client-Side Video</span>
          </>
        )}
      </button>
    </section>
  );
}
