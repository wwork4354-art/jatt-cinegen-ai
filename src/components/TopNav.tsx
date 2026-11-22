import { KeyRound } from 'lucide-react';
import type { UIStrings } from '../lib/i18n';
import type { StudioTab } from '../types/studio';

interface TopNavProps {
  activeTab: StudioTab;
  onSelectTab: (tab: StudioTab) => void;
  creationsCount: number;
  onResetWorkspace: () => void;
  onOpenEngineVault: () => void;
  configuredKeyCount: number;
  strings: UIStrings;
  developerAvatarUrl?: string | null;
}

export function TopNav({
  activeTab,
  onSelectTab,
  creationsCount,
  onResetWorkspace,
  onOpenEngineVault,
  configuredKeyCount,
  strings,
  developerAvatarUrl,
}: TopNavProps) {
  const navItems: { id: StudioTab; label: string }[] = [
    { id: 'text-to-video', label: strings.navTextToVideo },
    { id: 'image-to-video', label: strings.navImageToVideo },
    { id: 'lip-sync', label: strings.navLipSync },
    { id: 'text-to-image', label: strings.navTextToImage },
    { id: 'creations', label: strings.navMyCreations },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#07090E]/95">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Wordmark + Developer Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('text-to-video')}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-cyan-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-md px-1"
          >
            Jatt CineGen AI
          </button>

          <span className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[11px] font-medium text-cyan-200 whitespace-nowrap shrink-0">
            <img
              src={developerAvatarUrl || '/creator-avatar.png'}
              alt="Jatt Official"
              className="h-5 w-5 rounded-full object-cover border border-cyan-400/40"
            />
            <span>Developed by Jatt Official</span>
          </span>
        </div>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav
          aria-label="Studio modes"
          className="hidden md:flex items-center gap-4 lg:gap-6"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const displayLabel =
              item.id === 'creations' && creationsCount > 0
                ? `${item.label} (${creationsCount})`
                : item.label;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm ${
                  isActive ? 'text-cyan-300' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {displayLabel}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.85)]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Engine Keys Vault & New Canvas */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenEngineVault}
            title="AI Engines & Free API Keys"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 whitespace-nowrap shrink-0 transition-colors hover:border-cyan-400/60 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <KeyRound className="h-3.5 w-3.5 text-cyan-300" />
            <span className="hidden sm:inline">AI Engines &amp; Keys</span>
            <span className="sm:hidden">Engines</span>
            {configuredKeyCount > 0 && (
              <span className="rounded bg-cyan-400/25 px-1.5 py-0.5 text-[10px] font-mono text-cyan-100">
                {configuredKeyCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onResetWorkspace}
            className="min-h-[40px] rounded-lg border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0 transition-colors hover:border-cyan-400/50 hover:bg-cyan-400/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {strings.newCanvas}
          </button>
        </div>
      </div>

      {/* Compact Mobile Navigation Row */}
      <nav
        aria-label="Mobile studio modes"
        className="flex md:hidden items-center gap-1 overflow-x-auto border-t border-white/[0.06] px-4 py-1.5"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const displayLabel =
            item.id === 'creations' && creationsCount > 0
              ? `${item.label} (${creationsCount})`
              : item.label;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                isActive
                  ? 'bg-cyan-400/15 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {displayLabel}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
