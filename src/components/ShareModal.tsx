import { useState } from 'react';
import { Check, Copy, Download, Share2, X } from 'lucide-react';
import type { CreationItem } from '../types/studio';

interface ShareModalProps {
  item: CreationItem | null;
  onClose: () => void;
  onDownload: (item: CreationItem) => void;
}

export function ShareModal({ item, onClose, onDownload }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  if (!item) return null;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setShareStatus('Clipboard copy unavailable in this browser.');
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share) {
      setShareStatus('System Share Sheet is unavailable here. Use Download Full HD or Copy Prompt.');
      return;
    }

    try {
      const shareData: ShareData = {
        title: 'Jatt CineGen AI Creation',
        text: item.prompt,
      };

      let blobToShare = item.blob;
      if (!blobToShare && item.mediaUrl.startsWith('http')) {
        try {
          blobToShare = await fetch(item.mediaUrl).then((r) => r.blob());
        } catch {
          shareData.url = item.mediaUrl;
        }
      }

      if (blobToShare && navigator.canShare) {
        const ext =
          item.kind === 'image' ? 'jpg' : item.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blobToShare], `jatt-cinegen-ai-${item.id}.${ext}`, {
          type:
            blobToShare.type ||
            item.mimeType ||
            (item.kind === 'image' ? 'image/jpeg' : 'video/webm'),
        });
        if (navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }

      await navigator.share(shareData);
      setShareStatus('Shared successfully.');
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setShareStatus('Could not open native share sheet. You can download or copy the prompt below.');
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share creation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-5 rounded-2xl border border-white/10 bg-[#0D1118] p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">
            Share Creation
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
          {item.kind === 'image' ? (
            <img
              src={item.mediaUrl}
              alt={item.prompt}
              className="max-h-48 w-full object-contain"
            />
          ) : (
            <video
              src={item.mediaUrl}
              controls
              playsInline
              className="max-h-48 w-full object-contain"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-400">Prompt</div>
          <div className="rounded-xl border border-white/10 bg-[#07090E] p-3 text-xs leading-relaxed text-slate-200">
            {item.prompt}
          </div>
        </div>

        {shareStatus && (
          <p className="text-xs text-cyan-300">{shareStatus}</p>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied Prompt' : 'Copy Prompt'}
          </button>

          <button
            type="button"
            onClick={() => onDownload(item)}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download Full HD
          </button>
        </div>

        <button
          type="button"
          onClick={handleNativeShare}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
        >
          <Share2 className="h-4 w-4" />
          Share via Device Sheet
        </button>
      </div>
    </div>
  );
}
