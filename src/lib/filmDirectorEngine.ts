import {
  applyCharacterConsistencyLock,
  deriveSeedFromText,
} from '../../shared/characterConsistency';
import type {
  AspectRatio,
  FilmAmbienceMood,
  FilmCharacter,
  FilmDialogueShot,
  FilmTransitionStyle,
  VideoQuality,
} from '../types/studio';
import { fetchFreeAiImageWithWaterfall } from './freeImageWaterfall';
import type { RenderedVideoResult } from './lipSyncRenderer';
import {
  audioBufferToWavBlob,
  compressAudioPayloadIfNeeded,
  compressImageDataUrl,
} from './payloadCompressor';
import { getVoiceLanguageById } from './voiceLanguages';

export interface CharacterVoiceResult {
  wavBlob: Blob;
  audioBuffer: AudioBuffer;
  dataUrl: string;
  durationSeconds: number;
}

function getDimensions(aspectRatio: AspectRatio, quality: VideoQuality): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    if (quality === '4k') return { width: 1080, height: 1920 };
    return quality === '1080p' ? { width: 720, height: 1280 } : { width: 540, height: 960 };
  }
  if (aspectRatio === '1:1') {
    if (quality === '4k') return { width: 1440, height: 1440 };
    return quality === '1080p' ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  if (quality === '4k') return { width: 1920, height: 1080 };
  return quality === '1080p' ? { width: 1280, height: 720 } : { width: 960, height: 540 };
}

function chooseSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function loadPortraitElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Character portrait failed to load.'));
    img.src = src;
  });
}

function estimateFaceAnchor(img: HTMLImageElement): { normX: number; mouthNormY: number; faceRadiusNorm: number } {
  try {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const pctx = probe.getContext('2d');
    if (!pctx) return { normX: 0.5, mouthNormY: 0.43, faceRadiusNorm: 0.13 };

    pctx.drawImage(img, 0, 0, 64, 64);
    const { data } = pctx.getImageData(0, 0, 64, 64);

    let sumX = 0;
    let sumY = 0;
    let weightSum = 0;

    for (let y = 6; y < 38; y += 1) {
      for (let x = 14; x < 50; x += 1) {
        const idx = (y * 64 + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r > 80 && g > 50 && b > 35 && r > g && r - b > 15) {
          const w = 1 - Math.abs(x - 32) / 32 + 0.3;
          sumX += x * w;
          sumY += y * w;
          weightSum += w;
        }
      }
    }

    if (weightSum > 18) {
      return {
        normX: Math.min(0.68, Math.max(0.32, sumX / weightSum / 64)),
        mouthNormY: Math.min(0.62, Math.max(0.28, sumY / weightSum / 64 + 0.055)),
        faceRadiusNorm: 0.13,
      };
    }
  } catch {
    // Fallback center anchor
  }
  return { normX: 0.5, mouthNormY: 0.43, faceRadiusNorm: 0.13 };
}

function computeVoiceRate(character: FilmCharacter): { playbackRate: number; eqGainHz: number; eqDb: number } {
  let rate = 1.0;
  let eqGainHz = 1200;
  let eqDb = 0;

  if (character.gender === 'male') {
    rate *= 0.89;
    eqGainHz = 220;
    eqDb = 4.5;
  } else if (character.gender === 'female') {
    rate *= 1.12;
    eqGainHz = 2600;
    eqDb = 4.0;
  }

  if (character.ageTone === 'young') {
    rate *= 1.06;
  } else if (character.ageTone === 'elder') {
    rate *= 0.91;
    eqGainHz = 180;
    eqDb = 3.5;
  }

  return { playbackRate: Math.min(1.28, Math.max(0.78, rate)), eqGainHz, eqDb };
}

function createSyntheticSpeechCadenceBuffer(
  text: string,
  character: FilmCharacter
): AudioBuffer {
  const sampleRate = 22050;
  const wordCount = Math.max(2, text.trim().split(/\s+/).filter(Boolean).length);
  const duration = Math.min(9, Math.max(2.6, wordCount * 0.42));
  const length = Math.floor(sampleRate * duration);
  const ctx = new AudioContext();
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const baseHz = character.gender === 'male' ? 128 : character.gender === 'female' ? 218 : 168;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const syllableGate = Math.max(0, Math.sin(t * 7.2) * Math.cos(t * 2.9));
    const formant =
      0.55 * Math.sin(2 * Math.PI * baseHz * t) +
      0.28 * Math.sin(2 * Math.PI * (baseHz * 2.02) * t);
    data[i] = formant * syllableGate * 0.18;
  }
  ctx.close().catch(() => {});
  return buffer;
}

export async function synthesizeCharacterVoiceAudio(
  text: string,
  character: FilmCharacter
): Promise<CharacterVoiceResult> {
  const langMeta = getVoiceLanguageById(character.languageId);
  const hasShahmukhiScript = /[\u0600-\u06FF]/.test(text);
  const ttsLangCode =
    (langMeta.id === 'pa-PK' || langMeta.id === 'pa-FSD' || hasShahmukhiScript) &&
    langMeta.translateHintCode === 'pa'
      ? 'ur'
      : langMeta.translateHintCode || 'en';

  let decodedSource: AudioBuffer | null = null;
  const tempCtx = new AudioContext();

  try {
    const res = await fetch('/api/tts-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.trim(),
        languageCode: ttsLangCode,
      }),
    });

    if (res.ok) {
      const payload = (await res.json()) as { audioDataUrl?: string };
      if (payload.audioDataUrl) {
        const audioRes = await fetch(payload.audioDataUrl);
        const arrBuf = await audioRes.arrayBuffer();
        decodedSource = await tempCtx.decodeAudioData(arrBuf);
      }
    }
  } catch {
    // Fall through to cadence buffer
  } finally {
    tempCtx.close().catch(() => {});
  }

  if (!decodedSource) {
    decodedSource = createSyntheticSpeechCadenceBuffer(text, character);
  }

  // Apply voice gender/age DSP timbre shaping using OfflineAudioContext
  const { playbackRate, eqGainHz, eqDb } = computeVoiceRate(character);
  const targetDuration = Math.min(18, Math.max(1.8, decodedSource.duration / playbackRate));
  const outSamples = Math.max(1, Math.ceil(targetDuration * decodedSource.sampleRate));

  const offline = new OfflineAudioContext(
    1,
    outSamples,
    decodedSource.sampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = decodedSource;
  src.playbackRate.value = playbackRate;

  const filter = offline.createBiquadFilter();
  filter.type = character.gender === 'female' ? 'highshelf' : 'lowshelf';
  filter.frequency.value = eqGainHz;
  filter.gain.value = eqDb;

  const comp = offline.createDynamicsCompressor();
  src.connect(filter);
  filter.connect(comp);
  comp.connect(offline.destination);
  src.start(0);

  const shapedBuffer = await offline.startRendering();
  const rawWavBlob = audioBufferToWavBlob(shapedBuffer);
  const { blob: compressedWav, dataUrl } = await compressAudioPayloadIfNeeded(
    rawWavBlob,
    1_400_000
  );

  return {
    wavBlob: compressedWav,
    audioBuffer: shapedBuffer,
    dataUrl,
    durationSeconds: shapedBuffer.duration,
  };
}

function computeRmsEnvelopeAtTime(buffer: AudioBuffer, timeSec: number): number {
  const sampleRate = buffer.sampleRate;
  const centerIdx = Math.floor(timeSec * sampleRate);
  const windowSize = Math.floor(sampleRate * 0.045);
  const start = Math.max(0, centerIdx - Math.floor(windowSize / 2));
  const end = Math.min(buffer.length, start + windowSize);
  if (end <= start) return 0;

  const channel = buffer.getChannelData(0);
  let sumSq = 0;
  for (let i = start; i < end; i += 2) {
    const s = channel[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, Math.floor((end - start) / 2)));
  return Math.min(1, rms * 4.5);
}

async function tryCloudSingleSpeakerLipSync(params: {
  portraitDataUrl: string;
  audioDataUrl: string;
  hfToken?: string;
  replicateToken?: string;
  digenKey?: string;
}): Promise<HTMLVideoElement | null> {
  const { portraitDataUrl, audioDataUrl, hfToken, replicateToken, digenKey } = params;
  if (!digenKey?.trim() && !replicateToken?.trim() && !hfToken?.trim()) {
    return null;
  }

  try {
    const compressedPortrait = await compressImageDataUrl(portraitDataUrl, 768, 0.82);
    const res = await fetch('/api/generate/lip-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: compressedPortrait,
        audioDataUrl,
        hfToken: hfToken?.trim() || undefined,
        replicateToken: replicateToken?.trim() || undefined,
        digenKey: digenKey?.trim() || undefined,
      }),
    });

    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let videoPath: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { type?: string; videoApiPath?: string };
          if (evt.type === 'done' && evt.videoApiPath) {
            videoPath = evt.videoApiPath;
          } else if (evt.type === 'busy') {
            return null;
          }
        } catch {
          // Ignore malformed SSE event
        }
      }
    }

    if (!videoPath) return null;

    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;
    vid.src = videoPath;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Cloud video timeout')), 8000);
      vid.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      vid.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Cloud video load failed'));
      };
    });
    return vid;
  } catch {
    return null;
  }
}

function drawWrappedSubtitle(
  ctx: CanvasRenderingContext2D,
  speakerName: string,
  lineText: string,
  width: number,
  height: number
) {
  const paddingX = Math.round(width * 0.06);
  const maxTextW = width - paddingX * 2;
  const fontSize = Math.max(15, Math.round(width * 0.025));
  const hasRtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(lineText);

  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Noto Sans Tamil", "Noto Sans Telugu", "Noto Nastaliq Urdu", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = hasRtl ? 'rtl' : 'ltr';

  const words = `${speakerName}: ${lineText}`.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width > maxTextW && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const visibleLines = lines.slice(0, 2);
  const lineHeight = fontSize * 1.38;
  const boxH = visibleLines.length * lineHeight + 18;
  const boxY = height - boxH - Math.max(18, height * 0.04);

  ctx.fillStyle = 'rgba(7, 9, 14, 0.78)';
  ctx.fillRect(paddingX * 0.6, boxY, width - paddingX * 1.2, boxH);
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(paddingX * 0.6, boxY, width - paddingX * 1.2, boxH);

  for (let i = 0; i < visibleLines.length; i += 1) {
    const textY = boxY + 12 + lineHeight * (i + 0.5);
    ctx.fillStyle = i === 0 ? '#E2E8F0' : '#CBD5E1';
    ctx.fillText(visibleLines[i], width / 2, textY);
  }
  ctx.restore();
}

function scheduleAmbienceBed(
  ctx: AudioContext,
  dest: MediaStreamAudioDestinationNode,
  mood: FilmAmbienceMood,
  totalSeconds: number
) {
  if (mood === 'none') return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 0.8);
  gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + totalSeconds);
  gain.connect(dest);

  const freqs =
    mood === 'noir-suspense'
      ? [73.42, 110, 116.54]
      : mood === 'warm-sunset'
      ? [130.81, 196, 246.94]
      : [110, 164.81, 220];

  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = mood === 'noir-suspense' ? 'triangle' : 'sine';
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + totalSeconds + 0.1);
  }
}

export interface RenderFilmDirectorParams {
  sceneSetting: string;
  characters: FilmCharacter[];
  shots: FilmDialogueShot[];
  showSubtitles: boolean;
  transitionStyle: FilmTransitionStyle;
  ambienceMood: FilmAmbienceMood;
  tryCloudLipSync: boolean;
  aspectRatio: AspectRatio;
  quality: VideoQuality;
  togetherKey?: string;
  pollinationsKey?: string;
  hfToken?: string;
  replicateToken?: string;
  digenKey?: string;
  onFrameCanvas?: (canvas: HTMLCanvasElement) => void;
  onProgress: (percent: number, statusMessage: string) => void;
}

interface PreparedShot {
  shot: FilmDialogueShot;
  speaker: FilmCharacter;
  speakerImg: HTMLImageElement;
  speakerAnchor: { normX: number; mouthNormY: number; faceRadiusNorm: number };
  listenerImg: HTMLImageElement | null;
  cloudVideo: HTMLVideoElement | null;
  voice: CharacterVoiceResult;
  startSec: number;
  endSec: number;
}

export async function renderFilmDirectorSequence(
  params: RenderFilmDirectorParams
): Promise<RenderedVideoResult> {
  const {
    sceneSetting,
    characters,
    shots,
    showSubtitles,
    transitionStyle,
    ambienceMood,
    tryCloudLipSync,
    aspectRatio,
    quality,
    togetherKey,
    hfToken,
    replicateToken,
    digenKey,
    onFrameCanvas,
    onProgress,
  } = params;

  if (characters.length === 0 || shots.length === 0) {
    throw new Error('Add at least one character and one dialogue shot to render your film.');
  }

  const { width, height } = getDimensions(aspectRatio, quality);
  onProgress(8, 'Locking character faces & compressing portraits...');

  // Step 1: Ensure every character used in shots has a loaded consistent portrait
  const portraitMap = new Map<string, { dataUrl: string; img: HTMLImageElement; anchor: { normX: number; mouthNormY: number; faceRadiusNorm: number } }>();
  const usedCharIds = Array.from(new Set(shots.map((s) => s.characterId)));

  for (let idx = 0; idx < usedCharIds.length; idx += 1) {
    const char = characters.find((c) => c.id === charIdsOrFallback(usedCharIds[idx], characters));
    if (!char) continue;

    let rawPortrait = char.portraitDataUrl?.trim() || '';
    let tempBlobUrlToRevoke: string | null = null;
    if (!rawPortrait) {
      onProgress(10 + idx * 4, `Generating locked face portrait for ${char.name}...`);
      const { resolvedPrompt } = applyCharacterConsistencyLock(
        `cinematic film close-up portrait of ${char.name}, ${sceneSetting || 'dramatic studio lighting'}`,
        {
          enabled: true,
          characterName: char.name,
          traitsPrompt: char.appearancePrompt || 'natural expressive cinema face',
          fixedSeed: char.seed || deriveSeedFromText(char.name),
        }
      );
      const gen = await fetchFreeAiImageWithWaterfall({
        prompt: resolvedPrompt,
        aspectRatio: '1:1',
        style: 'cinematic',
        seed: char.seed || deriveSeedFromText(char.name),
        togetherKey,
      });
      rawPortrait = gen.objectUrl;
      tempBlobUrlToRevoke = gen.objectUrl;
    }

    const compressedPortrait = await compressImageDataUrl(rawPortrait, 896, 0.85);
    if (tempBlobUrlToRevoke) {
      URL.revokeObjectURL(tempBlobUrlToRevoke);
    }
    const img = await loadPortraitElement(compressedPortrait);
    portraitMap.set(char.id, {
      dataUrl: compressedPortrait,
      img,
      anchor: estimateFaceAnchor(img),
    });
  }

  // Step 2: Synthesize distinct character voices & optional single-speaker cloud lip-sync
  const preparedShots: PreparedShot[] = [];
  let cursorSec = 0;

  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const speaker = characters.find((c) => c.id === shot.characterId) ?? characters[0];
    const speakerPortrait = portraitMap.get(speaker.id) ?? Array.from(portraitMap.values())[0];
    if (!speakerPortrait) continue;

    onProgress(
      Math.min(44, 20 + Math.round(((i + 1) / shots.length) * 20)),
      `Synthesizing ${speaker.name} (${speaker.gender}/${speaker.ageTone}) dialogue voice ${i + 1}/${shots.length}...`
    );

    const voice = await synthesizeCharacterVoiceAudio(shot.dialogue, speaker);

    let cloudVideo: HTMLVideoElement | null = null;
    if (tryCloudLipSync && (digenKey?.trim() || replicateToken?.trim() || hfToken?.trim())) {
      onProgress(
        Math.min(50, 26 + Math.round(((i + 1) / shots.length) * 22)),
        `Lip-syncing ${speaker.name} via active GPU engine (${i + 1}/${shots.length})...`
      );
      cloudVideo = await tryCloudSingleSpeakerLipSync({
        portraitDataUrl: speakerPortrait.dataUrl,
        audioDataUrl: voice.dataUrl,
        hfToken,
        replicateToken,
        digenKey,
      });
    }

    // Pick a secondary cast member (silent listener) if available so only speaking character moves lips
    const listenerChar = characters.find((c) => c.id !== speaker.id && portraitMap.has(c.id));
    const listenerImg = listenerChar ? portraitMap.get(listenerChar.id)?.img ?? null : null;

    const shotDur = Math.max(1.8, voice.durationSeconds + 0.35);
    preparedShots.push({
      shot,
      speaker,
      speakerImg: speakerPortrait.img,
      speakerAnchor: speakerPortrait.anchor,
      listenerImg,
      cloudVideo,
      voice,
      startSec: cursorSec,
      endSec: cursorSec + shotDur,
    });
    cursorSec += shotDur;
  }

  if (preparedShots.length === 0) {
    throw new Error('Could not prepare any dialogue shots.');
  }

  const totalSeconds = cursorSec;
  const totalMs = totalSeconds * 1000;

  // Step 3: Set up Master Canvas + Audio Mix + MediaRecorder
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const fps = 16;
  const frameIntervalMs = Math.round(1000 / fps);
  const videoStream = canvas.captureStream(fps);
  const combinedTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioCtx();
  const dest = audioContext.createMediaStreamDestination();

  // Schedule each character's unique dialogue stem at exact shot timestamp
  for (const ps of preparedShots) {
    const src = audioContext.createBufferSource();
    src.buffer = ps.voice.audioBuffer;
    const g = audioContext.createGain();
    g.gain.value = 0.96;
    src.connect(g);
    g.connect(dest);
    src.start(audioContext.currentTime + ps.startSec);
  }
  scheduleAmbienceBed(audioContext, dest, ambienceMood, totalSeconds);
  combinedTracks.push(...dest.stream.getAudioTracks());

  const finalStream = new MediaStream(combinedTracks);
  const mimeType = chooseSupportedMimeType();
  const bitrate = quality === '4k' ? 9_000_000 : quality === '1080p' ? 5_200_000 : 2_800_000;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(finalStream, { mimeType, videoBitsPerSecond: bitrate });
  } catch {
    recorder = new MediaRecorder(finalStream);
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  let settledStop = false;
  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (settledStop) return;
      settledStop = true;
      resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    };
    recorder.onerror = () => {
      if (settledStop) return;
      settledStop = true;
      reject(new Error('Film sequence recording failed.'));
    };
  });

  onProgress(54, `Directing & stitching ${preparedShots.length}-shot dialogue scene (${totalSeconds.toFixed(1)}s)...`);
  recorder.start(350);

  let activeCloudShotIdx = -1;
  const startTime = performance.now();
  let lastProgressAt = 0;

  try {
    await new Promise<void>((resolve) => {
      let loopDone = false;
      const finish = () => {
        if (loopDone) return;
        loopDone = true;
        window.clearTimeout(safetyTimer);
        resolve();
      };
      const safetyTimer = window.setTimeout(finish, totalMs + 5000);

      const renderFrame = () => {
        if (loopDone) return;
        const now = performance.now();
        const elapsedMs = now - startTime;
        const elapsedSec = Math.min(totalSeconds, elapsedMs / 1000);

        let shotIdx = preparedShots.findIndex(
          (ps) => elapsedSec >= ps.startSec && elapsedSec < ps.endSec
        );
        if (shotIdx === -1) shotIdx = preparedShots.length - 1;
        const current = preparedShots[shotIdx];
        const localSec = Math.max(0, elapsedSec - current.startSec);
        const shotDuration = current.endSec - current.startSec;

        if (current.cloudVideo && activeCloudShotIdx !== shotIdx) {
          activeCloudShotIdx = shotIdx;
          current.cloudVideo.currentTime = 0;
          void current.cloudVideo.play().catch(() => {});
        }

        // Transition progress for shot opening (0..0.38s)
        const transDuration = transitionStyle === 'film-cut' ? 0.08 : 0.38;
        const transProgress = Math.min(1, localSec / transDuration);
        const offsetPanX =
          transitionStyle === 'whip-pan' && transProgress < 1
            ? (1 - transProgress) * width * 0.22
            : 0;

        // Clear cinema stage
        ctx.fillStyle = '#07090E';
        ctx.fillRect(0, 0, width, height);

        const energy = computeRmsEnvelopeAtTime(current.voice.audioBuffer, localSec);

        // Draw active speaker portrait OR cloud-synced video
        ctx.save();
        ctx.translate(offsetPanX, 0);
        if (transitionStyle === 'crossfade' && transProgress < 1) {
          ctx.globalAlpha = Math.max(0.2, transProgress);
        }

        if (current.cloudVideo && current.cloudVideo.readyState >= 2) {
          const vw = current.cloudVideo.videoWidth || width;
          const vh = current.cloudVideo.videoHeight || height;
          const scale = Math.max(width / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(current.cloudVideo, (width - dw) / 2, (height - dh) / 2, dw, dh);
        } else {
          // Two-character split/over-shoulder when silent cast exists, otherwise solo close-up
          const hasListener = Boolean(current.listenerImg) && width >= height;
          const speakerFrameW = hasListener ? width * 0.64 : width;
          const speakerX = hasListener ? width * 0.02 : 0;

          // Draw speaking character with isolated jaw lip-sync animation
          const img = current.speakerImg;
          const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
          const frameAspect = speakerFrameW / height;
          const drawH = imgAspect > frameAspect ? height : speakerFrameW / imgAspect;
          const drawW = imgAspect > frameAspect ? height * imgAspect : speakerFrameW;
          const zoom = 1.04 + (localSec / Math.max(1, shotDuration)) * 0.04 + energy * 0.012;
          const headBobY = Math.sin(localSec * 3.2) * height * 0.004 - energy * height * 0.004;

          ctx.save();
          ctx.beginPath();
          ctx.rect(speakerX, 0, speakerFrameW, height);
          ctx.clip();

          const cx = speakerX + speakerFrameW / 2;
          const cy = height / 2 + headBobY;
          ctx.translate(cx, cy);
          ctx.scale(zoom, zoom);
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

          // Isolated jaw articulation strictly on the active speaking character's face anchor
          const jawDrop = energy * drawH * 0.014;
          if (jawDrop > 0.7) {
            const mouthX = (current.speakerAnchor.normX - 0.5) * drawW;
            const mouthY = (current.speakerAnchor.mouthNormY - 0.5) * drawH;
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(
              mouthX,
              mouthY + jawDrop * 0.4,
              drawW * current.speakerAnchor.faceRadiusNorm * 0.56,
              drawH * current.speakerAnchor.faceRadiusNorm * 0.36,
              0,
              0,
              Math.PI * 2
            );
            ctx.clip();
            ctx.globalAlpha = 0.52;
            ctx.drawImage(img, -drawW / 2, -drawH / 2 + jawDrop, drawW, drawH);
            ctx.restore();
          }
          ctx.restore();

          // Draw silent co-star / listener panel with ZERO mouth movement (natural idle breath only)
          if (hasListener && current.listenerImg) {
            const listX = width * 0.68;
            const listW = width * 0.3;
            const listImg = current.listenerImg;
            const lAspect = listImg.naturalWidth / Math.max(1, listImg.naturalHeight);
            const lfAspect = listW / height;
            const lH = lAspect > lfAspect ? height : listW / lAspect;
            const lW = lAspect > lfAspect ? height * lAspect : listW;
            const idleBreath = 1.02 + Math.sin(elapsedSec * 1.4) * 0.006;

            ctx.save();
            ctx.beginPath();
            ctx.rect(listX, height * 0.08, listW, height * 0.84);
            ctx.clip();
            ctx.globalAlpha = 0.86;
            ctx.translate(listX + listW / 2, height / 2);
            ctx.scale(idleBreath, idleBreath);
            ctx.drawImage(listImg, -lW / 2, -lH / 2, lW, lH);
            ctx.restore();

            // Subtle frame hairline separating reaction shot
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(listX, height * 0.08, listW, height * 0.84);
          }
        }
        ctx.restore();

        // Cinema vignette & active speaker badge
        const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.25, width / 2, height / 2, width * 0.78);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(5,8,14,0.48)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);

        // Speaker nameplate
        ctx.save();
        ctx.fillStyle = 'rgba(7, 9, 14, 0.78)';
        ctx.fillRect(18, 18, 210, 30);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
        ctx.strokeRect(18, 18, 210, 30);
        ctx.font = '600 13px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#67E8F9';
        ctx.fillText(`Speaking: ${current.speaker.name}`, 28, 37);
        ctx.restore();

        if (showSubtitles && current.shot.dialogue.trim()) {
          drawWrappedSubtitle(ctx, current.speaker.name, current.shot.dialogue, width, height);
        }

        if (onFrameCanvas) onFrameCanvas(canvas);

        if (now - lastProgressAt >= 200 || elapsedMs >= totalMs) {
          lastProgressAt = now;
          const pct = Math.min(97, Math.round(54 + (elapsedSec / totalSeconds) * 43));
          onProgress(
            pct,
            `Rendering Shot ${shotIdx + 1}/${preparedShots.length} (${current.speaker.name}) · ${Math.max(
              0,
              Math.ceil(totalSeconds - elapsedSec)
            )}s left...`
          );
        }

        if (elapsedMs < totalMs) {
          window.setTimeout(renderFrame, frameIntervalMs);
        } else {
          finish();
        }
      };

      window.setTimeout(renderFrame, 0);
    });
  } finally {
    audioContext.close().catch(() => {});
  }

  onProgress(99, 'Finalizing multi-character film sequence...');
  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
  const blob = await Promise.race([
    recordingFinished,
    new Promise<Blob>((resolve) => {
      window.setTimeout(() => resolve(new Blob(chunks, { type: mimeType.split(';')[0] })), 3000);
    }),
  ]);

  onProgress(100, 'Film dialogue sequence ready.');
  return {
    blob,
    mediaUrl: URL.createObjectURL(blob),
    mimeType: blob.type || 'video/webm',
    width,
    height,
    scenes: preparedShots.map((ps) => `${ps.speaker.name}: "${ps.shot.dialogue}"`),
  };
}

function charIdsOrFallback(id: string, characters: FilmCharacter[]): string {
  return characters.some((c) => c.id === id) ? id : characters[0].id;
}
