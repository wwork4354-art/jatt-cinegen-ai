import { useRef, useState } from 'react';
import {
  BadgeCheck,
  Camera,
  ExternalLink,
  Globe,
  Instagram,
  Pencil,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import type { DeveloperProfile } from '../types/studio';

interface DeveloperFooterProps {
  profile: DeveloperProfile;
  onUpdateProfile: (next: DeveloperProfile) => void;
  footerCreditLabel: string;
}

const DEFAULT_AVATAR_URL = '/creator-avatar.png';

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function compressAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read avatar file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        const minSide = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - minSide) / 2;
        const sy = (img.naturalHeight - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function DeveloperFooter({
  profile,
  onUpdateProfile,
  footerCreditLabel,
}: DeveloperFooterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [youtubeDraft, setYoutubeDraft] = useState(profile.youtubeUrl);
  const [instagramDraft, setInstagramDraft] = useState(profile.instagramUrl);
  const [websiteDraft, setWebsiteDraft] = useState(profile.websiteUrl);

  const openEditor = () => {
    setYoutubeDraft(profile.youtubeUrl);
    setInstagramDraft(profile.instagramUrl);
    setWebsiteDraft(profile.websiteUrl);
    setIsEditorOpen(true);
  };

  const handleAvatarUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    try {
      const dataUrl = await compressAvatarImage(file);
      onUpdateProfile({
        ...profile,
        avatarDataUrl: dataUrl,
      });
    } catch {
      // Ignore invalid image errors cleanly
    }
  };

  const handleSaveLinks = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile({
      ...profile,
      youtubeUrl: youtubeDraft.trim(),
      instagramUrl: instagramDraft.trim(),
      websiteUrl: websiteDraft.trim(),
    });
    setIsEditorOpen(false);
  };

  const youtubeHref = normalizeUrl(profile.youtubeUrl);
  const instagramHref = normalizeUrl(profile.instagramUrl);
  const websiteHref = normalizeUrl(profile.websiteUrl);

  return (
    <footer className="border-t border-white/[0.08] bg-[#07090E]/95">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleAvatarUpload(file);
          e.target.value = '';
        }}
      />

      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Click avatar to customize photo"
            className="group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 transition-colors hover:border-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <img
              src={profile.avatarDataUrl || DEFAULT_AVATAR_URL}
              alt="Jatt Official developer avatar"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-3.5 w-3.5 text-white" />
            </span>
          </button>

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-semibold tracking-tight text-slate-100">
                Jatt CineGen AI
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
                <BadgeCheck className="h-3 w-3 text-cyan-400" />
                {footerCreditLabel}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              100% Free AI Video & Image Studio · Click avatar to customize photo
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {youtubeHref && (
            <a
              href={youtubeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
            >
              <Youtube className="h-3.5 w-3.5 text-rose-400" />
              <span>YouTube</span>
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </a>
          )}

          {instagramHref && (
            <a
              href={instagramHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
            >
              <Instagram className="h-3.5 w-3.5 text-fuchsia-400" />
              <span>Instagram</span>
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </a>
          )}

          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
            >
              <Globe className="h-3.5 w-3.5 text-cyan-400" />
              <span>App / Link</span>
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </a>
          )}

          <button
            type="button"
            onClick={openEditor}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5 text-cyan-400" />
            <span>Developer Profile & Links</span>
          </button>
        </div>
      </div>

      {isEditorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Developer branding settings"
          onClick={() => setIsEditorOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0D1118] p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-cyan-400" />
                <h2 className="font-display text-base font-semibold text-white">
                  Jatt Official — Developer Profile
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                aria-label="Close developer settings"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-[#07090E] p-3.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
                <img
                  src={profile.avatarDataUrl || DEFAULT_AVATAR_URL}
                  alt="Developer avatar preview"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Upload Avatar Photo
                </button>
                {profile.avatarDataUrl && profile.avatarDataUrl !== DEFAULT_AVATAR_URL && (
                  <button
                    type="button"
                    onClick={() => onUpdateProfile({ ...profile, avatarDataUrl: DEFAULT_AVATAR_URL })}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:border-rose-400/40 hover:text-rose-300 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Reset Default
                  </button>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveLinks} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="dev-youtube" className="block text-xs font-medium text-slate-300">
                  YouTube Channel URL
                </label>
                <input
                  id="dev-youtube"
                  type="text"
                  value={youtubeDraft}
                  onChange={(e) => setYoutubeDraft(e.target.value)}
                  placeholder="https://youtube.com/@jattofficial"
                  className="w-full rounded-lg border border-white/10 bg-[#07090E] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="dev-instagram" className="block text-xs font-medium text-slate-300">
                  Instagram Profile URL
                </label>
                <input
                  id="dev-instagram"
                  type="text"
                  value={instagramDraft}
                  onChange={(e) => setInstagramDraft(e.target.value)}
                  placeholder="https://instagram.com/jattofficial"
                  className="w-full rounded-lg border border-white/10 bg-[#07090E] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="dev-website" className="block text-xs font-medium text-slate-300">
                  Website / App Link
                </label>
                <input
                  id="dev-website"
                  type="text"
                  value={websiteDraft}
                  onChange={(e) => setWebsiteDraft(e.target.value)}
                  placeholder="https://your-app-or-portfolio.com"
                  className="w-full rounded-lg border border-white/10 bg-[#07090E] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="min-h-[38px] rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </footer>
  );
}
