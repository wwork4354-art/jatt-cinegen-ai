import { useMemo, useState } from 'react';
import {
  Download,
  Film,
  Image as ImageIcon,
  Search,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { UIStrings } from '../lib/i18n';
import type { CreationItem } from '../types/studio';

interface CreationsGalleryProps {
  creations: CreationItem[];
  onInspect: (item: CreationItem) => void;
  onDownload: (item: CreationItem) => void;
  onShare: (item: CreationItem) => void;
  onDelete: (id: string) => void;
  onStartCreating: () => void;
  strings: UIStrings;
}

export function CreationsGallery({
  creations,
  onInspect,
  onDownload,
  onShare,
  onDelete,
  onStartCreating,
  strings,
}: CreationsGalleryProps) {
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return creations.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (q && !item.prompt.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [creations, filter, search]);

  return (
    <section
      aria-label="My Creations gallery"
      className="space-y-6 rounded-2xl border border-white/[0.08] bg-[#0D1118] p-4 sm:p-7"
    >
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            {strings.creationsTitle}
          </h1>
          <p className="text-sm text-slate-400">
            {strings.creationsSubtitle}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={strings.searchPlaceholder}
              className="min-h-[40px] w-full rounded-xl border border-white/10 bg-[#07090E] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/70 focus:outline-none sm:w-56"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#07090E] p-1">
            {(['all', 'image', 'video'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                  filter === tab
                    ? 'bg-cyan-400/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === 'all'
                  ? strings.filterAll
                  : tab === 'image'
                  ? strings.filterImages
                  : strings.filterVideos}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Empty State */}
      {creations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#07090E]/60 px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-cyan-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="font-display text-lg font-semibold text-white">
            {strings.creationsEmptyTitle}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            {strings.creationsEmptySubtitle}
          </p>
          <button
            type="button"
            onClick={onStartCreating}
            className="mt-6 min-h-[42px] rounded-xl bg-cyan-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
          >
            {strings.createFirstBtn}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#07090E]/50 px-6 py-12 text-center text-sm text-slate-400">
          No creations match your current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#07090E] transition-colors hover:border-cyan-400/35"
            >
              {/* Media Preview */}
              <div
                onClick={() => onInspect(item)}
                className="relative aspect-video w-full cursor-pointer overflow-hidden bg-black"
              >
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
                    loop
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => {
                      e.currentTarget.play().catch(() => {});
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                    }}
                    className="h-full w-full object-cover"
                  />
                )}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-200">
                  {item.kind === 'image' ? (
                    <ImageIcon className="h-3.5 w-3.5 text-cyan-300" />
                  ) : (
                    <Film className="h-3.5 w-3.5 text-cyan-300" />
                  )}
                  <span>{item.kind === 'image' ? 'Image' : 'Video'}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.width}×{item.height}
                  </span>
                  {item.duration && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.duration}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Body & Actions */}
              <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                <div className="space-y-1.5">
                  <p className="line-clamp-2 text-sm leading-snug text-slate-200">
                    {item.prompt}
                  </p>
                  <div className="text-xs font-mono tabular-nums text-slate-500">
                    {new Date(item.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {item.engineLabel}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={() => onInspect(item)}
                    className="min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/10 transition-colors"
                  >
                    Open
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onDownload(item)}
                      title="Download Full HD"
                      aria-label="Download Full HD"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onShare(item)}
                      title="Share"
                      aria-label="Share"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item.id)}
                      title="Delete creation"
                      aria-label="Delete creation"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:border-rose-400/50 hover:text-rose-300 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
