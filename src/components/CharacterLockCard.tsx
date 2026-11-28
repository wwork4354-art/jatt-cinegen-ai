import { useRef, useState } from 'react';
import { ChevronDown, Lock, LockOpen, Shuffle, Upload, X } from 'lucide-react';
import type { CharacterFaceLockConfig, CreationItem } from '../types/studio';

interface CharacterLockCardProps {
  config: CharacterFaceLockConfig;
  onChange: (next: CharacterFaceLockConfig) => void;
  recentImages: CreationItem[];
}

export function CharacterLockCard({
  config,
  onChange,
  recentImages,
}: CharacterLockCardProps) {
  const [isExpanded, setIsExpanded] = useState(config.enabled);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleToggleEnabled = () => {
    const nextEnabled = !config.enabled;
    onChange({ ...config, enabled: nextEnabled });
    if (nextEnabled) setIsExpanded(true);
  };

  const handleUploadReference = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...config,
        enabled: true,
        referenceImageDataUrl: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRandomizeSeed = () => {
    onChange({
      ...config,
      fixedSeed: Math.floor(100000 + Math.random() * 899999),
    });
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        config.enabled
          ? 'border-cyan-400/40 bg-cyan-400/[0.06]'
          : 'border-white/[0.08] bg-[#07090E]/70'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          {config.enabled ? (
            <Lock className="h-4 w-4 shrink-0 text-cyan-300" />
          ) : (
            <LockOpen className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-slate-200">
                Character Face Lock
              </span>
              {config.enabled && (
                <span className="rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-cyan-200">
                  Seed {config.fixedSeed}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-slate-500">
              {config.enabled
                ? `${config.characterName || 'Locked Identity'} · consistent face across scenes`
                : 'Keep same face, clothing & seed across scenes'}
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          aria-label="Toggle Character Face Lock"
          onClick={handleToggleEnabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
            config.enabled
              ? 'border-cyan-400 bg-cyan-400/85'
              : 'border-white/15 bg-white/[0.06]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-slate-950 transition-transform ${
              config.enabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3 border-t border-white/[0.06] px-3 py-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Character Name
              </label>
              <input
                type="text"
                value={config.characterName}
                onChange={(e) => onChange({ ...config, characterName: e.target.value })}
                placeholder="e.g., Zara / Ali"
                className="w-full rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Consistency Seed
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={config.fixedSeed}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      fixedSeed: Math.max(1, Number(e.target.value) || 104277),
                    })
                  }
                  className="w-full rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-2 text-xs font-mono tabular-nums text-white focus:border-cyan-400/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleRandomizeSeed}
                  title="New Consistency Seed"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">
              Locked Facial Features, Outfit &amp; Lighting
            </label>
            <textarea
              rows={2}
              value={config.traitsPrompt}
              onChange={(e) => onChange({ ...config, traitsPrompt: e.target.value })}
              placeholder="e.g., short dark wavy hair, olive shalwar kameez, golden hour rim lighting, warm brown eyes"
              className="w-full resize-none rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadReference(file);
              }}
            />

            {config.referenceImageDataUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-black/40 p-1.5 pr-2.5">
                <img
                  src={config.referenceImageDataUrl}
                  alt="Locked character face"
                  className="h-9 w-9 rounded object-cover"
                />
                <span className="text-[11px] font-medium text-cyan-200">
                  Reference face locked
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ ...config, referenceImageDataUrl: null })}
                  aria-label="Clear reference face"
                  className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Face Photo
              </button>
            )}

            {recentImages.slice(0, 3).map((imgItem) => (
              <button
                key={imgItem.id}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    enabled: true,
                    referenceImageDataUrl: imgItem.mediaUrl,
                  })
                }
                title={`Lock face from: ${imgItem.prompt}`}
                className="h-9 w-9 overflow-hidden rounded-lg border border-white/15 hover:border-cyan-400"
              >
                <img
                  src={imgItem.mediaUrl}
                  alt={imgItem.prompt}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
