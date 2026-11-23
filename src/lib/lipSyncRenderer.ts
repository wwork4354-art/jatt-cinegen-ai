import { type AspectRatio, type VideoQuality } from '../types/studio';

export interface RenderedVideoResult {
  blob: Blob;
  mediaUrl: string;
  mimeType: string;
  width: number;
  height: number;
  scenes?: string[];
}

export interface RenderLipSyncParams {
  imageDataUrl: string;
  audioBlob: Blob | null;
  speechText?: string;
  speechLocale?: string;
  aspectRatio: AspectRatio;
  quality: VideoQuality;
  onFrameCanvas?: (sourceCanvas: HTMLCanvasElement) => void;
  onProgress: (
    percent: number,
    statusMessage: string,
    remainingSeconds?: number
  ) => void;
}

function getDimensions(aspectRatio: AspectRatio, quality: VideoQuality): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    if (quality === '4k') return { width: 2160, height: 3840 };
    return quality === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  if (aspectRatio === '1:1') {
    if (quality === '4k') return { width: 2160, height: 2160 };
    return quality === '1080p' ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  if (quality === '4k') return { width: 3840, height: 2160 };
  return quality === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function chooseSupportedMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ]
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function loadPortraitImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Portrait photo failed to load.'));
    img.src = src;
  });
}

/**
 * Lightweight 64x64 face-zone estimator: finds skin/bright center in upper 55% of portrait
 * so lower-jaw articulation anchors smoothly on close-ups and half-body shots.
 */
function estimateFaceAnchor(img: HTMLImageElement): { normX: number; mouthNormY: number; faceRadiusNorm: number } {
  try {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const pctx = probe.getContext('2d');
    if (!pctx) return { normX: 0.5, mouthNormY: 0.44, faceRadiusNorm: 0.14 };

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
        // Simple skin-luminance heuristic
        const isSkinTone = r > 80 && g > 50 && b > 35 && r > g && r - b > 15;
        if (isSkinTone) {
          const centerBias = 1 - Math.abs(x - 32) / 32;
          const w = centerBias + 0.3;
          sumX += x * w;
          sumY += y * w;
          weightSum += w;
        }
      }
    }

    if (weightSum > 18) {
      const cx = sumX / weightSum / 64;
      const cy = sumY / weightSum / 64;
      return {
        normX: Math.min(0.68, Math.max(0.32, cx)),
        mouthNormY: Math.min(0.62, Math.max(0.28, cy + 0.055)),
        faceRadiusNorm: 0.13,
      };
    }
  } catch {
    // Fallback to safe upper-center anchor on CORS/tainted frames
  }
  return { normX: 0.5, mouthNormY: 0.43, faceRadiusNorm: 0.13 };
}

export async function renderCanvasLipSyncVideo({
  imageDataUrl,
  audioBlob,
  speechText,
  speechLocale = 'en-US',
  aspectRatio,
  quality,
  onFrameCanvas,
  onProgress,
}: RenderLipSyncParams): Promise<RenderedVideoResult> {
  onProgress(22, 'Analyzing portrait photo & audio frequencies...');
  const img = await loadPortraitImage(imageDataUrl);
  const { width, height } = getDimensions(aspectRatio, quality);
  const faceAnchor = estimateFaceAnchor(img);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Browser canvas 2D context is unavailable.');
  }

  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support MediaRecorder video encoding.');
  }

  // Cover-fit geometry computed once
  const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const canvasAspect = width / height;
  let baseDrawW = width;
  let baseDrawH = height;
  if (imgAspect > canvasAspect) {
    baseDrawH = height;
    baseDrawW = height * imgAspect;
  } else {
    baseDrawW = width;
    baseDrawH = width / imgAspect;
  }

  // Pre-rendered blurred backdrop layer so portrait sway reveals rich depth rather than black bars
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = width;
  bgCanvas.height = height;
  const bgCtx = bgCanvas.getContext('2d');
  if (bgCtx) {
    bgCtx.filter = 'blur(26px) brightness(0.45)';
    bgCtx.drawImage(img, -width * 0.08, -height * 0.08, width * 1.16, height * 1.16);
    bgCtx.filter = 'none';
  }

  let audioContext: AudioContext | null = null;
  let audioSourceNode: AudioBufferSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let freqData: Uint8Array<ArrayBuffer> | null = null;
  let timeData: Uint8Array<ArrayBuffer> | null = null;
  const combinedTracks: MediaStreamTrack[] = [];

  const fps = 16;
  const frameIntervalMs = Math.round(1000 / fps);
  const videoStream = canvas.captureStream(fps);
  combinedTracks.push(...videoStream.getVideoTracks());

  // Safe duration target (caps at 24s on web to protect 3GB RAM devices while covering songs/dialogue cleanly)
  const wordCount = (speechText || '').trim().split(/\s+/).filter(Boolean).length;
  let totalSeconds = Math.min(22, Math.max(5, Math.ceil(wordCount * 0.45) + 2));

  if (audioBlob) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioCtx();
      const arrayBuf = await audioBlob.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuf);
      totalSeconds = Math.min(28, Math.max(3, Number(decodedBuffer.duration.toFixed(1))));

      const dest = audioContext.createMediaStreamDestination();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.95;

      audioSourceNode = audioContext.createBufferSource();
      audioSourceNode.buffer = decodedBuffer;
      audioSourceNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(dest);
      audioSourceNode.start(0);

      combinedTracks.push(...dest.stream.getAudioTracks());
    } catch {
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
      analyser = null;
    }
  }

  // Fallback browser speech synthesis if server TTS MP3 wasn't decoded
  if (!analyser && speechText?.trim() && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speechText.trim());
      utterance.lang = speechLocale;
      utterance.rate = 0.96;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore restricted speech synthesis devices
    }
  }

  const finalStream = new MediaStream(combinedTracks);
  const hasAudio = combinedTracks.some((t) => t.kind === 'audio');
  const mimeType = chooseSupportedMimeType(hasAudio);
  const bitrate = quality === '4k' ? 12_000_000 : quality === '1080p' ? 5_800_000 : 3_000_000;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(finalStream, {
      mimeType,
      videoBitsPerSecond: bitrate,
    });
  } catch {
    recorder = new MediaRecorder(finalStream);
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  let settledStop = false;
  const recordingFinished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (settledStop) return;
      settledStop = true;
      const cleanMime = mimeType.split(';')[0];
      resolve(new Blob(chunks, { type: cleanMime }));
    };
    recorder.onerror = () => {
      if (settledStop) return;
      settledStop = true;
      reject(new Error('Lip-Sync video recording failed.'));
    };
  });

  onProgress(35, `Animating 16fps lip-sync clip (${Math.round(totalSeconds)}s)...`, Math.ceil(totalSeconds));
  recorder.start(400);

  const startTime = performance.now();
  const totalMs = totalSeconds * 1000;
  let lastProgressAt = 0;
  let smoothedEnergy = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let loopDone = false;
      const finishLoop = () => {
        if (loopDone) return;
        loopDone = true;
        window.clearTimeout(loopSafetyTimer);
        resolve();
      };
      const failLoop = (err: unknown) => {
        if (loopDone) return;
        loopDone = true;
        window.clearTimeout(loopSafetyTimer);
        reject(err instanceof Error ? err : new Error('Lip-Sync rendering failed.'));
      };
      const loopSafetyTimer = window.setTimeout(finishLoop, totalMs + 6000);

      const tick = () => {
        if (loopDone) return;
        try {
          const now = performance.now();
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / totalMs);
          const elapsedSec = elapsed / 1000;

        // Compute live vocal/music energy (0..1)
        let rawEnergy = 0;
        if (analyser && timeData && freqData) {
          analyser.getByteTimeDomainData(timeData);
          analyser.getByteFrequencyData(freqData);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i += 2) {
            const sample = (timeData[i] - 128) / 128;
            sumSq += sample * sample;
          }
          const rms = Math.sqrt(sumSq / (timeData.length / 2));
          rawEnergy = Math.min(1, rms * 3.4);
        } else {
          // Natural cadence modulation when simulating speech amplitude
          const syllable = Math.abs(Math.sin(elapsedSec * 9.5) * Math.cos(elapsedSec * 4.1));
          const pauseGate = Math.sin(elapsedSec * 1.4) > -0.45 ? 1 : 0.15;
          rawEnergy = Math.min(1, syllable * pauseGate * 0.85);
        }

        smoothedEnergy = smoothedEnergy * 0.55 + rawEnergy * 0.45;

        // Draw blurred ambient backdrop
        ctx.drawImage(bgCanvas, 0, 0);

        // Portrait natural head nod, chest breathing zoom & organic sway
        const breathScale = 1.035 + Math.sin(elapsedSec * 1.6) * 0.012 + smoothedEnergy * 0.014;
        const headNodY = Math.sin(elapsedSec * 3.2) * height * 0.0045 - smoothedEnergy * height * 0.004;
        const headSwayX = Math.sin(elapsedSec * 1.45) * width * 0.008;
        const headTilt = Math.sin(elapsedSec * 1.8) * 0.011 + Math.sin(elapsedSec * 5.2) * smoothedEnergy * 0.006;

        ctx.save();
        ctx.translate(width / 2 + headSwayX, height / 2 + headNodY);
        ctx.rotate(headTilt);
        ctx.scale(breathScale, breathScale);
        ctx.drawImage(img, -baseDrawW / 2, -baseDrawH / 2, baseDrawW, baseDrawH);

        // Subtle lower-jaw/mouth speech articulation pass warped inside soft feathered face ellipse
        const mouthOffsetX = (faceAnchor.normX - 0.5) * baseDrawW;
        const mouthOffsetY = (faceAnchor.mouthNormY - 0.5) * baseDrawH;
        const jawDrop = smoothedEnergy * baseDrawH * 0.011;

        if (jawDrop > 0.6) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(
            mouthOffsetX,
            mouthOffsetY + jawDrop * 0.4,
            baseDrawW * faceAnchor.faceRadiusNorm * 0.55,
            baseDrawH * faceAnchor.faceRadiusNorm * 0.36,
            0,
            0,
            Math.PI * 2
          );
          ctx.clip();
          ctx.globalAlpha = 0.48;
          ctx.drawImage(
            img,
            -baseDrawW / 2,
            -baseDrawH / 2 + jawDrop,
            baseDrawW,
            baseDrawH
          );
          ctx.restore();
        }
        ctx.restore();

        // Audio-reactive studio aura & cinema vignette
        const aura = ctx.createRadialGradient(
          width / 2,
          height * 0.45,
          width * 0.12,
          width / 2,
          height * 0.5,
          width * 0.72
        );
        aura.addColorStop(0, `rgba(34, 211, 238, ${0.03 + smoothedEnergy * 0.08})`);
        aura.addColorStop(1, 'rgba(5, 8, 15, 0.42)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, width, height);

        // Sleek Audio Waveform Equalizer Bar at bottom
        const barCount = 28;
        const eqWidth = Math.min(width * 0.72, 520);
        const startX = (width - eqWidth) / 2;
        const baseY = height - Math.max(26, height * 0.045);
        const step = eqWidth / barCount;
        const barW = Math.max(3, step * 0.56);
        const maxBarH = Math.max(24, height * 0.055);

        ctx.save();
        ctx.fillStyle = 'rgba(7, 9, 14, 0.56)';
        ctx.fillRect(startX - 14, baseY - maxBarH - 8, eqWidth + 28, maxBarH + 18);

        for (let b = 0; b < barCount; b += 1) {
          let val = 0;
          if (freqData) {
            const binIdx = Math.min(freqData.length - 1, Math.floor((b / barCount) * 44) + 1);
            val = freqData[binIdx] / 255;
          } else {
            val =
              0.2 +
              0.8 *
                Math.abs(Math.sin(elapsedSec * 7.5 + b * 0.55)) *
                Math.max(0.25, smoothedEnergy);
          }
          const barH = Math.max(4, val * maxBarH);
          const bx = startX + b * step;
          const by = baseY - barH;
          const grad = ctx.createLinearGradient(0, by, 0, baseY);
          grad.addColorStop(0, '#67E8F9');
          grad.addColorStop(1, '#6366F1');
          ctx.fillStyle = grad;
          ctx.fillRect(bx, by, barW, barH);
        }
        ctx.restore();

        if (onFrameCanvas) {
          onFrameCanvas(canvas);
        }

        if (now - lastProgressAt >= 200 || elapsed >= totalMs) {
          lastProgressAt = now;
          const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
          const percent = Math.min(97, Math.round(35 + t * 62));
          onProgress(
            percent,
            `Rendering 16fps Lip-Sync Video · ${remainingSec}s remaining...`,
            remainingSec
          );
        }

          if (elapsed < totalMs) {
            window.setTimeout(tick, frameIntervalMs);
          } else {
            finishLoop();
          }
        } catch (err) {
          failLoop(err);
        }
      };

      window.setTimeout(tick, 0);
    });
  } finally {
    if (audioSourceNode) {
      try {
        audioSourceNode.stop();
      } catch {
        // Ignore stop error
      }
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
    }
  }

  onProgress(99, 'Finalizing downloadable Talking / Singing video...', 0);
  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
  const blob = await Promise.race([
    recordingFinished,
    new Promise<Blob>((resolve) => {
      window.setTimeout(() => {
        const cleanMime = mimeType.split(';')[0];
        resolve(new Blob(chunks, { type: cleanMime }));
      }, 3500);
    }),
  ]);
  const mediaUrl = URL.createObjectURL(blob);
  onProgress(100, 'Lip-Sync video ready.', 0);

  return {
    blob,
    mediaUrl,
    mimeType: blob.type || 'video/webm',
    width,
    height,
  };
}
