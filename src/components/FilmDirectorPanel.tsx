import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { deriveSeedFromText } from '../../shared/characterConsistency';
import {
  sanitizeUserText,
  validateMediaUploadFile,
  validateSafePromptAndScript,
} from '../../shared/securityShield';
import { fetchFreeAiImageWithWaterfall } from '../lib/freeImageWaterfall';
import { getVoiceLanguageById, VOICE_LANGUAGES } from '../lib/voiceLanguages';
import {
  speakVoiceConfirmation,
  stopVoiceReadback,
} from '../lib/voiceSpeaker';
import {
  type AspectRatio,
  type CharacterVoiceAge,
  type CharacterVoiceGender,
  type FilmAmbienceMood,
  type FilmCharacter,
  type FilmDialogueShot,
  type FilmTransitionStyle,
  type VideoQuality,
} from '../types/studio';

const ASPECT_RATIO_OPTIONS: Array<{ id: AspectRatio; label: string }> = [
  { id: '16:9', label: '16:9 Cinema Wide' },
  { id: '9:16', label: '9:16 Reels / Vertical' },
  { id: '1:1', label: '1:1 Square' },
];

interface FilmDirectorPanelProps {
  sceneSetting: string;
  onChangeSceneSetting: (val: string) => void;
  characters: FilmCharacter[];
  onChangeCharacters: (next: FilmCharacter[]) => void;
  shots: FilmDialogueShot[];
  onChangeShots: (next: FilmDialogueShot[]) => void;
  showSubtitles: boolean;
  onChangeShowSubtitles: (val: boolean) => void;
  transitionStyle: FilmTransitionStyle;
  onChangeTransitionStyle: (val: FilmTransitionStyle) => void;
  ambienceMood: FilmAmbienceMood;
  onChangeAmbienceMood: (val: FilmAmbienceMood) => void;
  tryCloudLipSync: boolean;
  onChangeTryCloudLipSync: (val: boolean) => void;
  aspectRatio: AspectRatio;
  onChangeAspectRatio: (val: AspectRatio) => void;
  quality: VideoQuality;
  onChangeQuality: (val: VideoQuality) => void;
  isGenerating: boolean;
  progressPercent: number;
  togetherKey?: string;
  pollinationsKey?: string;
  groqKey?: string;
  openRouterKey?: string;
  voiceAutoGenerate: boolean;
  onVoiceAutoGenerateChange: (enabled: boolean) => void;
  voiceReadbackEnabled: boolean;
  onVoiceReadbackChange: (enabled: boolean) => void;
  cooldownSeconds: number;
  onSecurityAlert: (message: string) => void;
  onRenderFilm: (overrideShots?: FilmDialogueShot[]) => void;
}

const FILM_PRESETS: Array<{
  label: string;
  setting: string;
  characters: Array<Omit<FilmCharacter, 'id' | 'portraitDataUrl' | 'seed'>>;
  shots: Array<{ speakerIdx: number; dialogue: string; action: string }>;
}> = [
  {
    label: 'Drama Confrontation (EN/UR)',
    setting: 'Rain-soaked neon street outside a Lahore tea stall at night, warm lanterns',
    characters: [
      {
        name: 'Hamza',
        appearancePrompt: 'handsome young man in dark leather jacket, intense expressive eyes',
        gender: 'male',
        ageTone: 'adult',
        languageId: 'ur',
      },
      {
        name: 'Ayesha',
        appearancePrompt: 'graceful young woman in emerald shawl, warm studio rim lighting',
        gender: 'female',
        ageTone: 'adult',
        languageId: 'ur',
      },
    ],
    shots: [
      {
        speakerIdx: 0,
        dialogue: 'تم نے مجھ سے وعدہ کیا تھا کہ تم سچ بتاؤ گی۔',
        action: 'Hamza speaks firmly looking directly ahead',
      },
      {
        speakerIdx: 1,
        dialogue: 'میں نے سب کچھ تمہاری حفاظت کے لیے چھپایا تھا۔',
        action: 'Ayesha replies calmly with emotional expression',
      },
    ],
  },
  {
    label: 'Punjabi Comedy Banter',
    setting: 'Sunny golden mustard fields beside a vibrant Pakistani village courtyard',
    characters: [
      {
        name: 'Jatt Singh',
        appearancePrompt: 'cheerful bearded man with classic turban and crisp waistcoat',
        gender: 'male',
        ageTone: 'adult',
        languageId: 'pa',
      },
      {
        name: 'Billa',
        appearancePrompt: 'energetic young sidekick in denim vest smiling broadly',
        gender: 'male',
        ageTone: 'young',
        languageId: 'pa',
      },
    ],
    shots: [
      {
        speakerIdx: 0,
        dialogue: 'او بیلیا، اج ٹریکٹر دی چابی کتھے چھپا دتی توں؟',
        action: 'Jatt Singh asks smiling playfully',
      },
      {
        speakerIdx: 1,
        dialogue: 'بھائی جان، چابی تاں چاء دے کپ کول ای پئی سی!',
        action: 'Billa laughs and responds quickly',
      },
    ],
  },
  {
    label: 'Sci-Fi Briefing (EN)',
    setting: 'Futuristic starship command deck overlooking a glowing cyan nebula',
    characters: [
      {
        name: 'Commander Vega',
        appearancePrompt: 'commanding female captain in sleek silver flight suit',
        gender: 'female',
        ageTone: 'adult',
        languageId: 'en',
      },
      {
        name: 'Dr. Aris',
        appearancePrompt: 'wise elder scientist with silver hair and holographic glasses',
        gender: 'male',
        ageTone: 'elder',
        languageId: 'en',
      },
    ],
    shots: [
      {
        speakerIdx: 0,
        dialogue: 'Sensors detect an unknown warp signature three light years ahead.',
        action: 'Vega delivers urgent bridge briefing',
      },
      {
        speakerIdx: 1,
        dialogue: 'Stabilize the core shields immediately. That signal is alive.',
        action: 'Dr. Aris warns with calm authority',
      },
    ],
  },
];

export function FilmDirectorPanel({
  sceneSetting,
  onChangeSceneSetting,
  characters,
  onChangeCharacters,
  shots,
  onChangeShots,
  showSubtitles,
  onChangeShowSubtitles,
  transitionStyle,
  onChangeTransitionStyle,
  ambienceMood,
  onChangeAmbienceMood,
  tryCloudLipSync,
  onChangeTryCloudLipSync,
  aspectRatio,
  onChangeAspectRatio,
  quality,
  onChangeQuality,
  isGenerating,
  progressPercent,
  togetherKey,
  groqKey,
  openRouterKey,
  voiceAutoGenerate,
  onVoiceAutoGenerateChange,
  voiceReadbackEnabled,
  onVoiceReadbackChange,
  cooldownSeconds,
  onSecurityAlert,
  onRenderFilm,
}: FilmDirectorPanelProps) {
  const [generatingPortraitFor, setGeneratingPortraitFor] = useState<string | null>(null);
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  // Voice-First Dialogue Dictation State
  const [activeShotId, setActiveShotId] = useState<string>(() => shots[0]?.id ?? '');
  const [isListeningDialogue, setIsListeningDialogue] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [autoRenderCountdown, setAutoRenderCountdown] = useState<number | null>(null);
  const [filmVoiceNote, setFilmVoiceNote] = useState<string | null>(null);
  const [filmVoiceError, setFilmVoiceError] = useState<string | null>(null);

  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const capturedSpeechRef = useRef('');
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const autoGenTimeoutRef = useRef<number | null>(null);
  const autoGenIntervalRef = useRef<number | null>(null);
  const voiceAutoGenRef = useRef(voiceAutoGenerate);
  voiceAutoGenRef.current = voiceAutoGenerate;
  const voiceReadbackRef = useRef(voiceReadbackEnabled);
  voiceReadbackRef.current = voiceReadbackEnabled;

  const resolvedTargetShot = shots.find((s) => s.id === activeShotId) ?? shots[0];
  const resolvedSpeaker =
    characters.find((c) => c.id === resolvedTargetShot?.characterId) ?? characters[0];
  const activeVoiceLang = getVoiceLanguageById(resolvedSpeaker?.languageId || 'ur');

  const clearAutoCountdown = () => {
    if (autoGenTimeoutRef.current !== null) {
      window.clearTimeout(autoGenTimeoutRef.current);
      autoGenTimeoutRef.current = null;
    }
    if (autoGenIntervalRef.current !== null) {
      window.clearInterval(autoGenIntervalRef.current);
      autoGenIntervalRef.current = null;
    }
    setAutoRenderCountdown(null);
  };

  useEffect(() => {
    return () => {
      clearAutoCountdown();
      stopVoiceReadback();
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore cleanup
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore cleanup
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const finalizeShotVoiceDictation = async (rawSpoken: string) => {
    const check = validateSafePromptAndScript(rawSpoken, 'Dialogue');
    if (!check.safe) {
      const msg = check.reason || 'Blocked unsafe spoken dialogue.';
      setFilmVoiceError(msg);
      onSecurityAlert(msg);
      return;
    }
    const cleanSpoken = check.sanitized.trim();
    if (!cleanSpoken) return;

    const currentShots = shotsRef.current;
    const targetShot = currentShots.find((s) => s.id === activeShotId) ?? currentShots[0];
    if (!targetShot) return;

    const targetSpeaker =
      charactersRef.current.find((c) => c.id === targetShot.characterId) ??
      charactersRef.current[0];
    const langId = targetSpeaker?.languageId || 'en';

    setIsProcessingVoice(true);
    setFilmVoiceNote(`Polishing dialogue line for ${targetSpeaker?.name || 'Actor'}...`);
    let finalDialogue = cleanSpoken;

    try {
      const res = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: cleanSpoken,
          mode: 'lip-sync',
          groqKey: groqKey?.trim() || undefined,
          openRouterKey: openRouterKey?.trim() || undefined,
          togetherKey: togetherKey?.trim() || undefined,
        }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { enhancedPrompt?: string };
        if (payload.enhancedPrompt?.trim()) {
          finalDialogue = sanitizeUserText(payload.enhancedPrompt.trim());
        }
      }
    } catch {
      // Keep clean spoken text if offline
    }

    const updatedShots = currentShots.map((s) =>
      s.id === targetShot.id ? { ...s, dialogue: finalDialogue } : s
    );
    onChangeShots(updatedShots);
    setIsProcessingVoice(false);
    setFilmVoiceNote(`Added dialogue to ${targetSpeaker?.name || 'Speaker'}.`);

    if (voiceAutoGenRef.current && !isGenerating) {
      clearAutoCountdown();
      setAutoRenderCountdown(2);
      if (voiceReadbackRef.current) {
        void speakVoiceConfirmation(langId, 'autoGeneratingIn2s');
      }
      let rem = 2;
      autoGenIntervalRef.current = window.setInterval(() => {
        rem -= 1;
        if (rem > 0) setAutoRenderCountdown(rem);
      }, 1000);
      autoGenTimeoutRef.current = window.setTimeout(() => {
        clearAutoCountdown();
        onRenderFilm(updatedShots);
      }, 2000);
    } else if (voiceReadbackRef.current) {
      void speakVoiceConfirmation(langId, 'promptEnhanced');
    }
  };

  const toggleFilmSpeakToCreate = async () => {
    if (isProcessingVoice || isGenerating) return;
    clearAutoCountdown();
    setFilmVoiceError(null);
    setFilmVoiceNote(null);

    if (isListeningDialogue && recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore stop
      }
      return;
    }

    if (isListeningDialogue && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop
      }
      return;
    }

    capturedSpeechRef.current = '';
    if (!voiceReadbackEnabled) {
      onVoiceReadbackChange(true);
    }
    void speakVoiceConfirmation(activeVoiceLang.id, 'filmListeningStart');

    if (groqKey?.trim() && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        chunksRef.current = [];
        const rec = new MediaRecorder(stream);
        recorderRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        rec.onstop = async () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;
          setIsListeningDialogue(false);
          if (chunks.length === 0) return;

          setIsProcessingVoice(true);
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            const base64Audio = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => {
                const str = String(r.result || '');
                const idx = str.indexOf(',');
                resolve(idx >= 0 ? str.slice(idx + 1) : str);
              };
              r.onerror = () => reject(new Error('Failed to read audio'));
              r.readAsDataURL(blob);
            });
            const whisperRes = await fetch('/api/transcribe-audio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64Audio,
                mimeType: blob.type || 'audio/webm',
                languageCode: activeVoiceLang.translateHintCode.split('-')[0] || 'en',
                groqKey: groqKey.trim(),
              }),
            });
            const whisperData = (await whisperRes.json()) as { text?: string };
            setIsProcessingVoice(false);
            if (whisperData.text?.trim()) {
              await finalizeShotVoiceDictation(whisperData.text.trim());
            } else {
              setFilmVoiceError('No clear speech detected. Please speak again.');
            }
          } catch {
            setIsProcessingVoice(false);
            setFilmVoiceError('Could not transcribe dialogue recording.');
          }
        };
        rec.start();
        setIsListeningDialogue(true);
        setFilmVoiceNote(`Recording ${activeVoiceLang.englishName} dialogue for ${resolvedSpeaker?.name || 'Actor'}...`);
        return;
      } catch {
        setFilmVoiceError('Microphone access denied.');
        return;
      }
    }

    const SpeechRecCtor =
      (
        window as unknown as {
          SpeechRecognition?: new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
            onerror: ((e: { error: string }) => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
          webkitSpeechRecognition?: new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
            onerror: ((e: { error: string }) => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
            onerror: ((e: { error: string }) => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          };
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      setFilmVoiceError('Speech recognition requires Chrome/Edge/Safari or a Groq Free API Key.');
      return;
    }

    try {
      const rec = new SpeechRecCtor();
      rec.lang = activeVoiceLang.speechCode;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (event) => {
        const results = event?.results;
        if (!results) return;
        for (let i = Math.max(0, Number(event.resultIndex) || 0); i < results.length; i += 1) {
          const item = results[i];
          if (item?.isFinal && item[0]?.transcript) {
            const safe = sanitizeUserText(item[0].transcript.trim());
            capturedSpeechRef.current = capturedSpeechRef.current
              ? `${capturedSpeechRef.current} ${safe}`
              : safe;
          }
        }
      };
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setFilmVoiceError('Microphone access denied. Please allow permission.');
        } else if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
          setFilmVoiceError(`Voice error: ${ev.error}`);
        }
        setIsListeningDialogue(false);
        recognitionRef.current = null;
      };
      rec.onend = () => {
        setIsListeningDialogue(false);
        recognitionRef.current = null;
        const spoken = capturedSpeechRef.current.trim();
        capturedSpeechRef.current = '';
        if (spoken) {
          void finalizeShotVoiceDictation(spoken);
        }
      };
      recognitionRef.current = rec;
      rec.start();
      setIsListeningDialogue(true);
      setFilmVoiceNote(`Listening in ${activeVoiceLang.nativeLabel} for ${resolvedSpeaker?.name || 'Speaker'}...`);
    } catch {
      setFilmVoiceError('Could not start voice recognition.');
      setIsListeningDialogue(false);
    }
  };

  const handleApplyPreset = (presetIndex: number) => {
    const preset = FILM_PRESETS[presetIndex];
    if (!preset) return;
    const nextChars: FilmCharacter[] = preset.characters.map((c, idx) => ({
      ...c,
      id: `char-${Date.now()}-${idx}`,
      portraitDataUrl: null,
      seed: deriveSeedFromText(c.name + c.appearancePrompt),
    }));
    const nextShots: FilmDialogueShot[] = preset.shots.map((s, idx) => ({
      id: `shot-${Date.now()}-${idx}`,
      characterId: nextChars[s.speakerIdx]?.id ?? nextChars[0].id,
      dialogue: s.dialogue,
      sceneAction: s.action,
    }));
    onChangeSceneSetting(preset.setting);
    onChangeCharacters(nextChars);
    onChangeShots(nextShots);
  };

  const handleAddCharacter = () => {
    const index = characters.length + 1;
    const name = `Character ${index}`;
    const newChar: FilmCharacter = {
      id: `char-${Date.now()}`,
      name,
      appearancePrompt: 'expressive film actor, natural cinematic portrait',
      portraitDataUrl: null,
      gender: index % 2 === 0 ? 'female' : 'male',
      ageTone: 'adult',
      languageId: 'en',
      seed: deriveSeedFromText(`${name}-${Date.now()}`),
    };
    onChangeCharacters([...characters, newChar]);
  };

  const handleUpdateCharacter = (id: string, patch: Partial<FilmCharacter>) => {
    onChangeCharacters(
      characters.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const handleRemoveCharacter = (id: string) => {
    if (characters.length <= 1) return;
    const remaining = characters.filter((c) => c.id !== id);
    onChangeCharacters(remaining);
    const fallbackId = remaining[0].id;
    onChangeShots(
      shots.map((s) => (s.characterId === id ? { ...s, characterId: fallbackId } : s))
    );
  };

  const handleGenerateCharFace = async (char: FilmCharacter) => {
    if (generatingPortraitFor) return;
    setGeneratingPortraitFor(char.id);
    try {
      const prompt = `Close-up cinema portrait facing front camera, ${char.name}, ${char.appearancePrompt}, ${sceneSetting}, realistic skin texture, clear eyes and closed natural mouth, 8k film still`;
      const result = await fetchFreeAiImageWithWaterfall({
        prompt,
        aspectRatio: '1:1',
        style: 'cinematic',
        seed: char.seed,
        togetherKey,
      });
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || result.objectUrl));
        reader.onerror = () => resolve(result.objectUrl);
        reader.readAsDataURL(result.blob);
      });
      URL.revokeObjectURL(result.objectUrl);
      handleUpdateCharacter(char.id, { portraitDataUrl: dataUrl });
    } catch {
      // Keep current portrait untouched on failure
    } finally {
      setGeneratingPortraitFor(null);
    }
  };

  const handleUploadCharFace = (charId: string, file: File) => {
    const check = validateMediaUploadFile(file, 'image');
    if (!check.valid) {
      onSecurityAlert(check.reason || 'Unsupported portrait image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      handleUpdateCharacter(charId, { portraitDataUrl: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  };

  const handleAddShot = () => {
    const lastCharId = shots[shots.length - 1]?.characterId;
    const nextChar =
      characters.find((c) => c.id !== lastCharId) ?? characters[0];
    onChangeShots([
      ...shots,
      {
        id: `shot-${Date.now()}`,
        characterId: nextChar.id,
        dialogue: '',
        sceneAction: `${nextChar.name} speaks directly on camera`,
      },
    ]);
  };

  const handleMoveShot = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= shots.length) return;
    const copy = [...shots];
    const temp = copy[idx];
    copy[idx] = copy[target];
    copy[target] = temp;
    onChangeShots(copy);
  };

  const canRender =
    !isGenerating &&
    cooldownSeconds === 0 &&
    characters.length > 0 &&
    shots.some((s) => s.dialogue.trim().length > 0);

  return (
    <aside
      aria-label="Film Scene and Dialogue Director controls"
      className="w-full rounded-2xl border border-white/[0.08] bg-[#0D1118] p-5 sm:p-6 flex flex-col gap-5"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clapperboard className="h-4 w-4 text-cyan-300" />
            <span>Film Scene &amp; Dialogue Director</span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-cyan-300">
            Multi-Cast Lip-Sync
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          Assign lines to different characters. Each speaker receives a distinct voice and isolated face lip-sync before stitching into one movie.
        </p>
      </div>

      {/* Voice-First Dialogue Control inside Film Director */}
      <div className="rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-400/12 via-cyan-400/[0.06] to-indigo-400/10 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
          <span className="font-semibold text-cyan-200">
            Voice Dialogue Mode ({resolvedSpeaker?.name || 'Speaker'} · {activeVoiceLang.nativeLabel})
          </span>
          <select
            aria-label="Target shot for voice dictation"
            value={resolvedTargetShot?.id || ''}
            onChange={(e) => setActiveShotId(e.target.value)}
            className="rounded-md border border-white/15 bg-[#07090E] px-2 py-0.5 text-[11px] text-slate-200"
          >
            {shots.map((s, idx) => (
              <option key={s.id} value={s.id}>
                Shot 0{idx + 1}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={toggleFilmSpeakToCreate}
          disabled={isProcessingVoice || isGenerating}
          aria-pressed={isListeningDialogue}
          className={`flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-60 ${
            isListeningDialogue
              ? 'border border-rose-400/80 bg-rose-500/25 text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.4)]'
              : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
          }`}
        >
          {isProcessingVoice ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Polishing Spoken Dialogue...</span>
            </>
          ) : isListeningDialogue ? (
            <>
              <MicOff className="h-4 w-4" />
              <span>Finish Dialogue ({activeVoiceLang.nativeLabel})</span>
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              <span>Speak to Create (Bol Kar Banayein) · {activeVoiceLang.nativeLabel}</span>
            </>
          )}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={voiceAutoGenerate}
              onChange={(e) => {
                onVoiceAutoGenerateChange(e.target.checked);
                if (!e.target.checked) clearAutoCountdown();
              }}
              className="h-4 w-4 rounded border-white/25 bg-[#07090E] accent-cyan-400"
            />
            <span className="font-semibold">Voice Auto-Generate (2s)</span>
          </label>

          <button
            type="button"
            role="switch"
            aria-checked={voiceReadbackEnabled}
            onClick={() => {
              const next = !voiceReadbackEnabled;
              onVoiceReadbackChange(next);
              if (!next) stopVoiceReadback();
            }}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-semibold transition-colors ${
              voiceReadbackEnabled
                ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                : 'border-white/10 bg-[#07090E]/80 text-slate-400'
            }`}
          >
            {voiceReadbackEnabled ? (
              <Volume2 className="h-3 w-3 text-cyan-300" />
            ) : (
              <VolumeX className="h-3 w-3 text-slate-400" />
            )}
            <span>Readback: {voiceReadbackEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {autoRenderCountdown !== null && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-xs text-amber-100">
            <span className="font-mono font-semibold tabular-nums">
              Auto-rendering film in {autoRenderCountdown}s...
            </span>
            <button
              type="button"
              onClick={() => {
                clearAutoCountdown();
                if (voiceReadbackEnabled) {
                  void speakVoiceConfirmation(activeVoiceLang.id, 'autoGenCancelled');
                }
              }}
              className="rounded border border-amber-300/60 bg-black/40 px-2 py-0.5 text-[11px] font-bold text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {filmVoiceNote && !filmVoiceError && (
          <p className="text-[11px] text-slate-300">{filmVoiceNote}</p>
        )}
        {filmVoiceError && <p className="text-[11px] text-amber-300">{filmVoiceError}</p>}
      </div>

      {/* Quick Film Script Presets */}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-slate-300">Quick Film Presets</span>
        <div className="flex flex-wrap gap-1.5">
          {FILM_PRESETS.map((preset, idx) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleApplyPreset(idx)}
              className="rounded-lg border border-white/10 bg-[#07090E] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scene Visual Setting */}
      <div className="space-y-1.5">
        <label htmlFor="film-scene-setting" className="block text-xs font-medium text-slate-300">
          Scene Location &amp; Lighting
        </label>
        <input
          id="film-scene-setting"
          type="text"
          value={sceneSetting}
          onChange={(e) => onChangeSceneSetting(e.target.value)}
          placeholder="e.g., Rain-soaked neon alley at sunset, golden rim light"
          className="w-full rounded-xl border border-white/10 bg-[#07090E] px-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
        />
      </div>

      {/* Cast Roster */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">
            Cast Roster ({characters.length})
          </span>
          <button
            type="button"
            onClick={handleAddCharacter}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/20"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Character
          </button>
        </div>

        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
          {characters.map((char, idx) => {
            const isBusy = generatingPortraitFor === char.id;
            return (
              <div
                key={char.id}
                className="rounded-xl border border-white/[0.08] bg-[#07090E] p-3 space-y-2.5"
              >
                <div className="flex items-start gap-2.5">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black/60 flex items-center justify-center">
                    {char.portraitDataUrl ? (
                      <img
                        src={char.portraitDataUrl}
                        alt={char.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500">
                        Cast {idx + 1}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) =>
                          handleUpdateCharacter(char.id, { name: e.target.value })
                        }
                        placeholder="Actor Name"
                        className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-1.5 text-xs font-semibold text-white focus:border-cyan-400/60 focus:outline-none"
                      />
                      {characters.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCharacter(char.id)}
                          aria-label={`Remove ${char.name}`}
                          className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        ref={(el) => {
                          fileInputsRef.current[char.id] = el;
                        }}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadCharFace(char.id, file);
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputsRef.current[char.id]?.click()}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
                      >
                        <Upload className="h-3 w-3" />
                        Face Photo
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(generatingPortraitFor)}
                        onClick={() => handleGenerateCharFace(char)}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {isBusy ? 'Drawing...' : 'AI Face'}
                      </button>
                    </div>
                  </div>
                </div>

                <input
                  type="text"
                  value={char.appearancePrompt}
                  onChange={(e) =>
                    handleUpdateCharacter(char.id, { appearancePrompt: e.target.value })
                  }
                  placeholder="Appearance traits & outfit"
                  className="w-full rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
                />

                <div className="grid grid-cols-3 gap-1.5">
                  <select
                    aria-label={`${char.name} voice gender`}
                    value={char.gender}
                    onChange={(e) =>
                      handleUpdateCharacter(char.id, {
                        gender: e.target.value as CharacterVoiceGender,
                      })
                    }
                    className="rounded-lg border border-white/10 bg-[#0D1118] px-2 py-1.5 text-[11px] text-slate-200"
                  >
                    <option value="male">Male Voice</option>
                    <option value="female">Female Voice</option>
                    <option value="neutral">Neutral</option>
                  </select>

                  <select
                    aria-label={`${char.name} age tone`}
                    value={char.ageTone}
                    onChange={(e) =>
                      handleUpdateCharacter(char.id, {
                        ageTone: e.target.value as CharacterVoiceAge,
                      })
                    }
                    className="rounded-lg border border-white/10 bg-[#0D1118] px-2 py-1.5 text-[11px] text-slate-200"
                  >
                    <option value="young">Young</option>
                    <option value="adult">Adult</option>
                    <option value="elder">Elder</option>
                  </select>

                  <select
                    aria-label={`${char.name} language`}
                    value={char.languageId}
                    onChange={(e) =>
                      handleUpdateCharacter(char.id, { languageId: e.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-[#0D1118] px-2 py-1.5 text-[11px] text-slate-200"
                  >
                    {VOICE_LANGUAGES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.englishName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dialogue Shot Timeline */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">
            Dialogue Shots ({shots.length})
          </span>
          <button
            type="button"
            onClick={handleAddShot}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Line
          </button>
        </div>

        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
          {shots.map((shot, idx) => (
            <div
              key={shot.id}
              className="rounded-xl border border-white/[0.08] bg-[#07090E] p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono tabular-nums text-cyan-300">
                  Shot 0{idx + 1}
                </span>
                <select
                  aria-label={`Shot ${idx + 1} speaker`}
                  value={shot.characterId}
                  onChange={(e) =>
                    onChangeShots(
                      shots.map((s) =>
                        s.id === shot.id ? { ...s, characterId: e.target.value } : s
                      )
                    )
                  }
                  className="flex-1 rounded-lg border border-white/10 bg-[#0D1118] px-2 py-1 text-xs font-medium text-white"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      Speaker: {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMoveShot(idx, -1)}
                    aria-label="Move shot up"
                    className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === shots.length - 1}
                    onClick={() => handleMoveShot(idx, 1)}
                    aria-label="Move shot down"
                    className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  {shots.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onChangeShots(shots.filter((s) => s.id !== shot.id))
                      }
                      aria-label="Delete shot"
                      className="rounded p-1 text-slate-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={2}
                value={shot.dialogue}
                onChange={(e) =>
                  onChangeShots(
                    shots.map((s) =>
                      s.id === shot.id ? { ...s, dialogue: e.target.value } : s
                    )
                  )
                }
                placeholder="Type exact spoken dialogue line for this character..."
                className="w-full resize-none rounded-lg border border-white/10 bg-[#0D1118] px-2.5 py-2 text-xs text-white placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Film Options */}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Transition
          </label>
          <select
            value={transitionStyle}
            onChange={(e) => onChangeTransitionStyle(e.target.value as FilmTransitionStyle)}
            className="w-full rounded-xl border border-white/10 bg-[#07090E] px-2.5 py-2 text-xs text-slate-200"
          >
            <option value="crossfade">Cinema Crossfade</option>
            <option value="film-cut">Direct Film Cut</option>
            <option value="whip-pan">Whip Pan</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Ambience Score
          </label>
          <select
            value={ambienceMood}
            onChange={(e) => onChangeAmbienceMood(e.target.value as FilmAmbienceMood)}
            className="w-full rounded-xl border border-white/10 bg-[#07090E] px-2.5 py-2 text-xs text-slate-200"
          >
            <option value="cinema-drama">Cinema Drama</option>
            <option value="warm-sunset">Warm Sunset</option>
            <option value="noir-suspense">Noir Suspense</option>
            <option value="none">Dialogue Only</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Aspect Ratio
          </label>
          <select
            value={aspectRatio}
            onChange={(e) => onChangeAspectRatio(e.target.value as AspectRatio)}
            className="w-full rounded-xl border border-white/10 bg-[#07090E] px-2.5 py-2 text-xs text-slate-200"
          >
            {ASPECT_RATIO_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Export Quality
          </label>
          <select
            value={quality}
            onChange={(e) => onChangeQuality(e.target.value as VideoQuality)}
            className="w-full rounded-xl border border-white/10 bg-[#07090E] px-2.5 py-2 text-xs text-slate-200"
          >
            <option value="720p">720p Fast</option>
            <option value="1080p">1080p Full HD</option>
            <option value="4k">4K Ultra HD</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#07090E] px-3 py-2.5">
        <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={showSubtitles}
            onChange={(e) => onChangeShowSubtitles(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-[#0D1118] accent-cyan-400"
          />
          <span>Movie Subtitles</span>
        </label>

        <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={tryCloudLipSync}
            onChange={(e) => onChangeTryCloudLipSync(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-[#0D1118] accent-cyan-400"
          />
          <span>Cloud GPU Lip-Sync Boost</span>
        </label>
      </div>

      <button
        type="button"
        disabled={!canRender}
        onClick={() => onRenderFilm()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 px-5 py-3 text-sm font-bold text-slate-950 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-mono tabular-nums">Rendering Film · {progressPercent}%</span>
          </>
        ) : cooldownSeconds > 0 ? (
          <span className="font-mono tabular-nums">Cooldown · Wait {cooldownSeconds}s</span>
        ) : (
          <>
            <Clapperboard className="h-4 w-4" />
            <span>Render Film Dialogue Sequence</span>
          </>
        )}
      </button>
    </aside>
  );
}
