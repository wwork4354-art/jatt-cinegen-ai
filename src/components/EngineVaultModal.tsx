import { useState } from 'react';
import { Check, Cpu, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, X } from 'lucide-react';
import { maskApiKey } from '../../shared/securityShield';
import type { EngineVaultKeys } from '../types/studio';

interface EngineVaultModalProps {
  isOpen: boolean;
  keys: EngineVaultKeys;
  customBackendUrl: string;
  onSave: (nextKeys: EngineVaultKeys, nextBackendUrl: string) => void;
  onClose: () => void;
}

function EngineStatusBadge({
  isActive,
  maskedKey,
  fallbackHint,
}: {
  isActive: boolean;
  maskedKey?: string;
  fallbackHint: string;
}) {
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 font-mono">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Active{maskedKey ? ` · ${maskedKey}` : ''}
      </span>
    );
  }
  return <span className="text-[10px] font-mono text-slate-400">{fallbackHint}</span>;
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
  const [draftDigenKey, setDraftDigenKey] = useState(keys.digenKey ?? '');
  const [draftAgnesKey, setDraftAgnesKey] = useState(keys.agnesKey ?? '');
  const [draftFalKey, setDraftFalKey] = useState(keys.falKey ?? '');
  const [draftReplicateToken, setDraftReplicateToken] = useState(keys.replicateToken ?? '');
  const [draftTogetherKey, setDraftTogetherKey] = useState(keys.togetherKey ?? '');
  const [draftGroqKey, setDraftGroqKey] = useState(keys.groqKey ?? '');
  const [draftOpenRouterKey, setDraftOpenRouterKey] = useState(keys.openRouterKey ?? '');
  const [draftBackendUrl, setDraftBackendUrl] = useState(customBackendUrl);
  const [visibleField, setVisibleField] = useState<
    | 'gemini'
    | 'hf'
    | 'sf'
    | 'pollinations'
    | 'digen'
    | 'agnes'
    | 'fal'
    | 'replicate'
    | 'together'
    | 'groq'
    | 'openrouter'
    | null
  >(null);

  if (!isOpen) return null;

  const buildNextKeys = (): EngineVaultKeys => ({
    geminiKey: draftGeminiKey.trim(),
    hfToken: draftHfToken.trim(),
    siliconFlowKey: draftSiliconFlowKey.trim(),
    pollinationsKey: draftPollinationsKey.trim(),
    digenKey: draftDigenKey.trim(),
    agnesKey: draftAgnesKey.trim(),
    falKey: draftFalKey.trim(),
    replicateToken: draftReplicateToken.trim(),
    togetherKey: draftTogetherKey.trim(),
    groqKey: draftGroqKey.trim(),
    openRouterKey: draftOpenRouterKey.trim(),
  });

  const handleSave = () => {
    onSave(buildNextKeys(), draftBackendUrl.trim());
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
              <code className="text-cyan-300">VITE_GROQ_API_KEY</code>,{' '}
              <code className="text-cyan-300">VITE_FAL_KEY</code>) automatically, or paste keys here (<code className="text-slate-300">localStorage</code>) for real GPU motion, Whisper voice &amp; script enhancement.
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
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] px-3.5 py-2.5 text-[11px] text-cyan-100/90 flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-cyan-400" />
          <div className="space-y-0.5 leading-relaxed">
            <div>
              Video &amp; Lip-Sync Router: <strong className="text-white">SiliconFlow</strong> →{' '}
              <strong className="text-white">HF Inference</strong> →{' '}
              <strong className="text-cyan-300">Digen AI</strong> →{' '}
              <strong className="text-white">Agnes AI</strong> →{' '}
              <strong className="text-white">Fal.ai</strong> →{' '}
              <strong className="text-white">Replicate</strong> →{' '}
              <strong className="text-cyan-300">Google Veo</strong>
            </div>
            <div className="text-emerald-300/95">
              Enhance, Voice &amp; Images: Groq (Llama 3.3 &amp; Whisper) · OpenRouter · Together AI
            </div>
          </div>
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
              <EngineStatusBadge
                isActive={Boolean(draftGeminiKey.trim())}
                maskedKey={maskApiKey(draftGeminiKey)}
                fallbackHint="veo-2.0-generate-001"
              />
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
              <EngineStatusBadge
                isActive={Boolean(draftHfToken.trim())}
                maskedKey={maskApiKey(draftHfToken)}
                fallbackHint="LTX · Wan2.1 · SVD · SadTalker"
              />
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
                3. SiliconFlow Free Credit Key (VITE_SILICONFLOW_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftSiliconFlowKey.trim())}
                maskedKey={maskApiKey(draftSiliconFlowKey)}
                fallbackHint="Wan-AI/Wan2.1-T2V-14B"
              />
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
              <EngineStatusBadge
                isActive={Boolean(draftPollinationsKey.trim())}
                maskedKey={maskApiKey(draftPollinationsKey)}
                fallbackHint="seedance · wan · veo"
              />
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

          {/* 5. Digen AI API Key (VITE_DIGEN_API_KEY) */}
          <div className="space-y-1.5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-digen-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                Digen AI API Key (VITE_DIGEN_API_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftDigenKey.trim())}
                maskedKey={maskApiKey(draftDigenKey)}
                fallbackHint="Video & Talking Avatar"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex flex-1 items-center">
                <input
                  id="vault-digen-key"
                  type={visibleField === 'digen' ? 'text' : 'password'}
                  value={draftDigenKey}
                  onChange={(e) => setDraftDigenKey(e.target.value)}
                  placeholder="digen_... (https://api.digen.ai Video & Lip-Sync)"
                  autoComplete="off"
                  className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                />
                <button
                  type="button"
                  onClick={() =>
                    setVisibleField((v) => (v === 'digen' ? null : 'digen'))
                  }
                  aria-label="Toggle Digen AI key visibility"
                  className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
                >
                  {visibleField === 'digen' ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onSave(buildNextKeys(), draftBackendUrl.trim())}
                className="min-h-[40px] shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/25 transition-colors"
              >
                Save
              </button>
            </div>
          </div>

          {/* 6. Agnes AI Free Video Key (VITE_AGNES_API_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-agnes-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                5. Agnes AI Free Video Key (Agnes-Video-2.5 · VITE_AGNES_API_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftAgnesKey.trim())}
                maskedKey={maskApiKey(draftAgnesKey)}
                fallbackHint="VITE_AGNES_API_KEY"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-agnes-key"
                type={visibleField === 'agnes' ? 'text' : 'password'}
                value={draftAgnesKey}
                onChange={(e) => setDraftAgnesKey(e.target.value)}
                placeholder="agnes_... (optional Agnes AI free video API key)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'agnes' ? null : 'agnes'))
                }
                aria-label="Toggle Agnes AI key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'agnes' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 6. Fal.ai Video Key (VITE_FAL_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-fal-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                6. Fal.ai Video Key (Kling / Minimax / Wan · VITE_FAL_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftFalKey.trim())}
                maskedKey={maskApiKey(draftFalKey)}
                fallbackHint="wan/v2.1 · minimax-video"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-fal-key"
                type={visibleField === 'fal' ? 'text' : 'password'}
                value={draftFalKey}
                onChange={(e) => setDraftFalKey(e.target.value)}
                placeholder="key_id:secret (optional Fal.ai video key)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() => setVisibleField((v) => (v === 'fal' ? null : 'fal'))}
                aria-label="Toggle Fal.ai key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'fal' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 7. Replicate API Token (VITE_REPLICATE_API_TOKEN) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-replicate-token"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                7. Replicate API Token (Wan2.1 / SadTalker · VITE_REPLICATE_API_TOKEN)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftReplicateToken.trim())}
                maskedKey={maskApiKey(draftReplicateToken)}
                fallbackHint="wan-2.1-t2v-480p · sadtalker"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-replicate-token"
                type={visibleField === 'replicate' ? 'text' : 'password'}
                value={draftReplicateToken}
                onChange={(e) => setDraftReplicateToken(e.target.value)}
                placeholder="r8_... (optional Replicate API token)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'replicate' ? null : 'replicate'))
                }
                aria-label="Toggle Replicate API token visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'replicate' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 8. Together AI Key (VITE_TOGETHER_API_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-together-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                8. Together AI Key (FLUX Images &amp; Prompt Enhancer)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftTogetherKey.trim())}
                maskedKey={maskApiKey(draftTogetherKey)}
                fallbackHint="VITE_TOGETHER_API_KEY"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-together-key"
                type={visibleField === 'together' ? 'text' : 'password'}
                value={draftTogetherKey}
                onChange={(e) => setDraftTogetherKey(e.target.value)}
                placeholder="tgp_v1_... (optional Together AI key for FLUX & Llama)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'together' ? null : 'together'))
                }
                aria-label="Toggle Together AI key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'together' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 9. Groq Free API Key (VITE_GROQ_API_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-groq-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                9. Groq Free API Key (VITE_GROQ_API_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftGroqKey.trim())}
                maskedKey={maskApiKey(draftGroqKey)}
                fallbackHint="Llama 3.3 · Whisper Voice"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-groq-key"
                type={visibleField === 'groq' ? 'text' : 'password'}
                value={draftGroqKey}
                onChange={(e) => setDraftGroqKey(e.target.value)}
                placeholder="gsk_... (Llama 3.3 Enhance & Whisper Voice Input)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'groq' ? null : 'groq'))
                }
                aria-label="Toggle Groq API key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'groq' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 10. OpenRouter Free API Key (VITE_OPENROUTER_API_KEY) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-openrouter-key"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                10. OpenRouter Free API Key (VITE_OPENROUTER_API_KEY)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftOpenRouterKey.trim())}
                maskedKey={maskApiKey(draftOpenRouterKey)}
                fallbackHint="Llama 3.3 :free · Gemini :free"
              />
            </div>
            <div className="relative flex items-center">
              <input
                id="vault-openrouter-key"
                type={visibleField === 'openrouter' ? 'text' : 'password'}
                value={draftOpenRouterKey}
                onChange={(e) => setDraftOpenRouterKey(e.target.value)}
                placeholder="sk-or-... (free fallback for Enhance & Dialogue)"
                autoComplete="off"
                className="min-h-[40px] w-full rounded-lg border border-white/10 bg-[#07090E] pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-400/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              />
              <button
                type="button"
                onClick={() =>
                  setVisibleField((v) => (v === 'openrouter' ? null : 'openrouter'))
                }
                aria-label="Toggle OpenRouter API key visibility"
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-white"
              >
                {visibleField === 'openrouter' ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Optional Custom Backend Endpoint */}
          <div className="space-y-1.5 border-t border-white/[0.08] pt-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="vault-backend-url"
                className="block text-xs font-medium text-slate-300"
              >
                Custom Colab / FastAPI Backend URL (Optional)
              </label>
              <EngineStatusBadge
                isActive={Boolean(draftBackendUrl.trim())}
                fallbackHint="FastAPI / Colab"
              />
            </div>
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
              setDraftDigenKey('');
              setDraftAgnesKey('');
              setDraftFalKey('');
              setDraftReplicateToken('');
              setDraftTogetherKey('');
              setDraftGroqKey('');
              setDraftOpenRouterKey('');
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
