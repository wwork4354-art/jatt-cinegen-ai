import { useState } from 'react';
import { Check, Cpu, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { EngineVaultKeys } from '../types/studio';

interface EngineVaultModalProps {
  isOpen: boolean;
  keys: EngineVaultKeys;
  customBackendUrl: string;
  onSave: (nextKeys: EngineVaultKeys, nextBackendUrl: string) => void;
  onClose: () => void;
}

export function EngineVaultModal({
  isOpen,
  keys,
  customBackendUrl,
  onSave,
  onClose,
}: EngineVaultModalProps) {
  const [draftGeminiKey, setDraftGeminiKey] = useState(keys.geminiKey);
  const [draftHfToken, setDraftHfToken] = useState(keys.hfToken);
  const [draftSiliconFlowKey, setDraftSiliconFlowKey] = useState(keys.siliconFlowKey);
  const [draftPollinationsKey, setDraftPollinationsKey] = useState(keys.pollinationsKey ?? '');
  const [draftBackendUrl, setDraftBackendUrl] = useState(customBackendUrl);
  const [visibleField, setVisibleField] = useState<'gemini' | 'hf' | 'sf' | 'pollinations' | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(
      {
        geminiKey: draftGeminiKey.trim(),
        hfToken: draftHfToken.trim(),
        siliconFlowKey: draftSiliconFlowKey.trim(),
        pollinationsKey: draftPollinationsKey.trim(),
      },
      draftBackendUrl.trim()
    );
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Engines & Free API Keys"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0D1118] p-5 sm:p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <Cpu className="h-5 w-5 text-cyan-400" />
              AI Engines &amp; Free API Keys
            </h2>
            <p className="text-xs leading-relaxed text-slate-400">
              Reads Vercel env keys (<code className="text-cyan-300">VITE_HF_TOKEN</code>,{' '}
              <code className="text-cyan-300">VITE_GEMINI_API_KEY</code>) automatically, or paste keys here (<code className="text-slate-300">localStorage</code>) for real GPU motion in AI Studio Preview &amp; Vercel Live.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Engines modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Waterfall Order Overview */}
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] px-3.5 py-2.5 text-[11px] text-cyan-100/90 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400" />
          <span>
            Real Video Router: <strong className="text-white">SiliconFlow (Wan 2.1)</strong> →{' '}
            <strong className="text-white">HF Inference (Wan 2.1 · CogVideoX-5b · LTX-Video)</strong> →{' '}
            <strong className="text-cyan-300">Google Veo 2.0</strong> →{' '}
            <span className="text-slate-300">Animated Pollinations Fallback</span>
          </span>
        </div>

        <div className="space-y-4">
          {/* 1. Google Gemini / Veo Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-gemini-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                1. Google Gemini / Veo API Key (VITE_GEMINI_API_KEY)
              </label>
              <span className="text-[10px] font-mono text-slate-400">
                {draftGeminiKey.trim() ? 'Active' : 'veo-2.0-generate-001'}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-gemini-key"
                type={visibleField === 'gemini' ? 'text' : 'password'}
                value={draftGeminiKey}
                onChange={(e) => setDraftGeminiKey(e.target.value)}
                placeholder="AIza... (optional Google Veo key)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() => setVisibleField((v) => (v === 'gemini' ? null : 'gemini'))}
                aria-label="Toggle Google Veo key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'gemini' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* 2. Hugging Face Free Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-hf-token"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                2. Hugging Face Free Token (VITE_HF_TOKEN)
              </label>
              <span className="text-[10px] font-mono text-slate-400">
                {draftHfToken.trim() ? 'Active' : 'LTX · Wan2.1 · SVD · SadTalker'}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-hf-token"
                type={visibleField === 'hf' ? 'text' : 'password'}
                value={draftHfToken}
                onChange={(e) => setDraftHfToken(e.target.value)}
                placeholder="hf_... (free Hugging Face Read token for real GPU motion)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() => setVisibleField((v) => (v === 'hf' ? null : 'hf'))}
                aria-label="Toggle Hugging Face token visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'hf' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* 3. SiliconFlow Free Credit Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-sf-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                3. SiliconFlow Free Credit Key (Optional)
              </label>
              <span className="text-[10px] font-mono text-slate-400">Wan-AI/Wan2.1-T2V-14B</span>
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-sf-key"
                type={visibleField === 'sf' ? 'text' : 'password'}
                value={draftSiliconFlowKey}
                onChange={(e) => setDraftSiliconFlowKey(e.target.value)}
                placeholder="sk-... (optional SiliconFlow API key)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() => setVisibleField((v) => (v === 'sf' ? null : 'sf'))}
                aria-label="Toggle SiliconFlow key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'sf' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* 4. Pollinations.ai Video API Key (Optional VITE_POLLINATIONS_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-pollinations-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                4. Pollinations.ai Video Key (VITE_POLLINATIONS_KEY)
              </label>
              <span className="text-[10px] font-mono text-slate-400">
                {draftPollinationsKey.trim() ? 'Active' : 'seedance · wan · veo'}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-pollinations-key"
                type={visibleField === 'pollinations' ? 'text' : 'password'}
                value={draftPollinationsKey}
                onChange={(e) => setDraftPollinationsKey(e.target.value)}
                placeholder="pk_... or sk_... (optional enter.pollinations.ai key)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'pollinations' ? null : 'pollinations'))
                }
                aria-label="Toggle Pollinations key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'pollinations' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Optional Custom Backend Endpoint */}
          <div className="space-y-1.5 border-t border-white/[0.08] pt-3">
            <label
              htmlFor="vault-backend-url"
              className="block text-xs font-medium text-slate-300"
            >
              Custom Colab / FastAPI Backend URL (Optional)
            </label>
            <input
              id="vault-backend-url"
              type="url"
              value={draftBackendUrl}
              onChange={(e) => setDraftBackendUrl(e.target.value)}
              placeholder="https://your-colab-tunnel.trycloudflare.com/generate"
              className="min-h-[38px] w-full rounded-lg border border-white/10 bg-[#07090E] px-3 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={() => {
              setDraftGeminiKey('');
              setDraftHfToken('');
              setDraftSiliconFlowKey('');
              setDraftPollinationsKey('');
              setDraftBackendUrl('');
            }}
            className="text-xs font-medium text-slate-400 hover:text-rose-300 transition-colors"
          >
            Reset Keys to Default
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              Save Engine Vault
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
