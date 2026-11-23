import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  generateLipSyncVideo,
  generateSmartMultiEngineVideo,
  getCachedHfVideo,
  getCachedRefImage,
  type HfAspectRatio,
  type HfVideoMode,
} from './server/hfVideoService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

type StudioMode = 'text-to-image' | 'text-to-video' | 'image-to-video';
type AspectRatio = '16:9' | '9:16' | '1:1';
type StylePreset = 'realistic' | 'anime' | '3d-render' | 'cinematic' | 'none';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a free-tier Gemini API key in Settings > Secrets to use Magic Enhance Prompt.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 400, message: raw };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API key is invalid or missing permissions. Please verify your key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Gemini free-tier rate limit reached. Please wait a moment and try again.',
    };
  }
  return { status: 500, message: raw || 'Unexpected server error.' };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // 1. Magic Enhance Prompt using free-tier gemini-4-hydrogen
  app.post('/api/enhance-prompt', async (req, res) => {
    try {
      const { prompt, mode, style, cameraMotion } = req.body as {
        prompt?: string;
        mode?: StudioMode;
        style?: StylePreset;
        cameraMotion?: string;
      };

      const cleanPrompt = (prompt || '').trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Please enter a starting idea before enhancing.' });
        return;
      }

      const ai = getGeminiClient();
      const targetFormat =
        mode === 'text-to-image'
          ? 'a single high-resolution still photograph or artwork'
          : mode === 'image-to-video'
          ? 'animating a reference image with natural subject movement and camera motion'
          : 'a cohesive cinematic video clip';

      const styleHint = style && style !== 'none' ? `Target visual style: ${style}.` : '';
      const cameraHint =
        cameraMotion && mode !== 'text-to-image' ? `Desired camera movement: ${cameraMotion}.` : '';

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Enhance this creative prompt for ${targetFormat}: "${cleanPrompt}". ${styleHint} ${cameraHint}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are an expert cinematography and visual prompt director. Rewrite the user input into one vivid, cohesive, production-ready prompt under 75 words. Focus on concrete visual subjects, lighting, atmosphere, lens/texture details, and natural motion when video is requested. Return ONLY the enhanced prompt text with no quotes, no preamble, and no markdown.',
        },
      });

      const enhancedPrompt = (response.text ?? '').trim().replace(/^["']|["']$/g, '');
      if (!enhancedPrompt) {
        throw new Error('Model returned an empty prompt enhancement.');
      }

      res.json({ enhancedPrompt });
    } catch (error) {
      const parsed = parseGeminiErrorMessage(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 1b. Translate multilingual voice/text prompt into vivid English for Pollinations AI
  app.post('/api/translate-prompt', async (req, res) => {
    try {
      const { prompt, sourceLanguage, translateHintCode } = req.body as {
        prompt?: string;
        sourceLanguage?: string;
        translateHintCode?: string;
      };

      const cleanPrompt = (prompt || '').trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const hasNonAscii = /[^\x20-\x7E\r\n\t]/.test(cleanPrompt);
      if (!hasNonAscii && (!sourceLanguage || sourceLanguage === 'English')) {
        res.json({ translatedPrompt: cleanPrompt, wasTranslated: false });
        return;
      }

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = getGeminiClient();
          const langNote = sourceLanguage ? ` (spoken/written in ${sourceLanguage})` : '';
          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Translate this visual image/video generation prompt${langNote} into clear, vivid, natural English suitable for an AI image/video generator. If it is already English, refine grammar slightly without losing any meaning. Return ONLY the English prompt with no quotes or explanation:\n\n${cleanPrompt}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'You are a multilingual translator specializing in South Asian, Middle Eastern, East Asian, and European languages (including Urdu, Punjabi, Saraiki, Pashto, Balochi, Hindi, Bengali, Persian, Arabic, Tamil, Marathi, Sanskrit, Russian, Chinese). Translate accurately to natural descriptive English. Return ONLY the translated English text.',
            },
          });

          const translated = (response.text ?? '').trim().replace(/^["']|["']$/g, '');
          if (translated) {
            res.json({ translatedPrompt: translated, wasTranslated: translated !== cleanPrompt });
            return;
          }
        } catch {
          // Fall through to free zero-key translation fallback below
        }
      }

      // Free zero-key translation fallback via Google Translate public GTX endpoint
      const sl = translateHintCode && translateHintCode !== 'en' ? translateHintCode : 'auto';
      const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sl
      )}&tl=en&dt=t&q=${encodeURIComponent(cleanPrompt)}`;
      const gtxRes = await fetch(gtxUrl);
      if (gtxRes.ok) {
        const gtxData = (await gtxRes.json()) as unknown[];
        if (Array.isArray(gtxData[0])) {
          const translated = gtxData[0]
            .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
            .join('')
            .trim();
          if (translated) {
            res.json({ translatedPrompt: translated, wasTranslated: translated !== cleanPrompt });
            return;
          }
        }
      }

      res.json({ translatedPrompt: cleanPrompt, wasTranslated: false });
    } catch {
      res.json({ translatedPrompt: (req.body as { prompt?: string })?.prompt || '', wasTranslated: false });
    }
  });

  // 1c. Expand a single prompt into 3 sequential scenes for 15s multi-scene video
  app.post('/api/expand-scenes', async (req, res) => {
    try {
      const { prompt, style, cameraMotion } = req.body as {
        prompt?: string;
        style?: StylePreset;
        cameraMotion?: string;
      };

      const cleanPrompt = (prompt || '').trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const ai = getGeminiClient();
      const styleHint = style && style !== 'none' ? `Visual style: ${style}.` : '';
      const cameraHint = cameraMotion ? `Camera feel: ${cameraMotion}.` : '';

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Break this single video idea into 3 connected sequential 5-second film scenes in clear descriptive English (Scene 1: Beginning, Scene 2: Action/Middle, Scene 3: Ending). Keep characters, setting, and lighting visually consistent across all 3 scenes. Prompt: "${cleanPrompt}". ${styleHint} ${cameraHint}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Exactly 3 sequential visual scene prompts in English under 45 words each.',
              },
            },
            required: ['scenes'],
          },
          systemInstruction:
            'You are a film director creating a 3-shot 15-second storyboard. Always output the 3 scene prompts in vivid descriptive English (translate if the input prompt is in another language) representing Beginning, Middle Action, and Ending payoff.',
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as { scenes?: string[] };
      if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 3) {
        throw new Error('Could not generate 3 sequential scenes.');
      }

      res.json({ scenes: parsed.scenes.slice(0, 3) });
    } catch (error) {
      const parsed = parseGeminiErrorMessage(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 2. Smart Multi-Engine Video Router (Veo -> Pollinations Video -> HF Inference API -> SiliconFlow -> Live HF Spaces -> Stitched 16fps Fallback)
  app.post('/api/generate/hf-video', async (req, res) => {
    const {
      prompt,
      mode,
      aspectRatio,
      style,
      duration,
      imageDataUrl,
      geminiKey,
      hfToken,
      siliconFlowKey,
      pollinationsKey,
    } = req.body as {
      prompt?: string;
      mode?: HfVideoMode;
      aspectRatio?: HfAspectRatio;
      style?: StylePreset;
      duration?: '5s' | '10s' | '15s';
      imageDataUrl?: string;
      geminiKey?: string;
      hfToken?: string;
      siliconFlowKey?: string;
      pollinationsKey?: string;
    };

    const cleanPrompt = (prompt || '').trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const safeMode: HfVideoMode = mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
    const safeRatio: HfAspectRatio =
      aspectRatio === '9:16' || aspectRatio === '1:1' ? aspectRatio : '16:9';
    const safeDuration = duration === '10s' || duration === '15s' ? duration : '5s';

    const styleSuffix =
      style === 'cinematic'
        ? 'cinematic film lighting, dramatic motion, 4k sharp focus'
        : style === 'anime'
        ? 'theatrical anime animation, fluid motion, expressive lighting'
        : style === '3d-render'
        ? 'octane 3d animation, physically based materials, smooth fluid motion'
        : style === 'realistic'
        ? 'photorealistic live action footage, natural camera motion, sharp texture'
        : '';

    const fullPrompt = styleSuffix ? `${cleanPrompt}, ${styleSuffix}` : cleanPrompt;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let aborted = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
      }
    });

    const sendEvent = (payload: unknown) => {
      if (aborted || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const proto =
      (typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : req.protocol) || 'https';
    const hostHeader =
      (typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host'].split(',')[0].trim()
        : req.headers.host) || '';
    const publicOrigin = hostHeader && !hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1')
      ? `${proto}://${hostHeader}`
      : undefined;

    sendEvent({
      type: 'progress',
      percent: 10,
      message: 'Generating real MP4 via Pollinations.ai Video API...',
    });

    let routeTimer: NodeJS.Timeout | undefined;
    try {
      const routeTimeout = new Promise<never>((_, reject) => {
        routeTimer = setTimeout(() => {
          aborted = true;
          reject(new Error('60-second video generation timeout reached'));
        }, 60000);
      });

      await Promise.race([
        generateSmartMultiEngineVideo({
          prompt: fullPrompt,
          mode: safeMode,
          aspectRatio: safeRatio,
          duration: safeDuration,
          imageDataUrl,
          publicOrigin,
          geminiKey,
          hfToken,
          siliconFlowKey,
          pollinationsKey,
          isAborted: () => aborted,
          onEvent: (event) => {
            sendEvent(event);
          },
        }),
        routeTimeout,
      ]);
    } catch (err) {
      if (!res.writableEnded) {
        aborted = false;
        sendEvent({
          type: 'busy',
          message:
            err instanceof Error
              ? err.message
              : 'Video API endpoints timed out. Please add a Pollinations or Hugging Face key in API Keys and retry.',
        });
      }
    } finally {
      if (routeTimer) clearTimeout(routeTimer);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // 2a. Serve temporary reference photo for Pollinations image[0] Image-to-Video requests
  app.get('/api/hf-video-ref/:id', (req, res) => {
    const entry = getCachedRefImage(req.params.id);
    if (!entry) {
      res.status(404).send('Reference image expired.');
      return;
    }
    res.setHeader('Content-Type', entry.mimeType || 'image/png');
    res.setHeader('Content-Length', String(entry.buffer.byteLength));
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.end(entry.buffer);
  });

  // 2b. Serve cached MP4 video with byte-range support for HTML5 <video> & direct download
  app.get('/api/hf-video-file/:id', (req, res) => {
    const entry = getCachedHfVideo(req.params.id);
    if (!entry) {
      res.status(404).send('Video expired or not found. Please generate again.');
      return;
    }

    const total = entry.buffer.byteLength;
    const rangeHeader = req.headers.range;

    res.setHeader('Content-Type', entry.mimeType || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=600');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        if (start >= 0 && start < total && start <= end) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          res.end(entry.buffer.subarray(start, end + 1));
          return;
        }
      }
    }

    res.status(200);
    res.setHeader('Content-Length', String(total));
    res.end(entry.buffer);
  });

  // 2c. Free Zero-Key Multilingual AI Speech Synthesis (MP3) for Lip-Sync & Talking Photos
  app.post('/api/tts-audio', async (req, res) => {
    try {
      const { text, languageCode } = req.body as {
        text?: string;
        languageCode?: string;
      };

      const cleanText = (text || '').trim().replace(/\s+/g, ' ');
      if (!cleanText) {
        res.status(400).json({ error: 'Dialogue text is required to synthesize AI voice.' });
        return;
      }

      // Split into <= 175 char segments on word/punctuation boundaries
      const chunks: string[] = [];
      let remaining = cleanText.slice(0, 900);
      while (remaining.length > 0) {
        if (remaining.length <= 175) {
          chunks.push(remaining);
          break;
        }
        let splitIdx = remaining.lastIndexOf(' ', 175);
        if (splitIdx < 40) splitIdx = 175;
        chunks.push(remaining.slice(0, splitIdx).trim());
        remaining = remaining.slice(splitIdx).trim();
      }

      const rawCode = (languageCode || 'en').trim();
      const candidateLangs = Array.from(
        new Set([
          rawCode === 'zh-CN' ? 'zh-CN' : rawCode.split('-')[0] || 'en',
          rawCode,
          'ur',
          'hi',
          'en',
        ])
      );

      let audioChunks: Buffer[] | null = null;
      let usedLang = candidateLangs[0];

      for (const tl of candidateLangs) {
        try {
          const buffers: Buffer[] = [];
          for (const chunk of chunks) {
            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
              tl
            )}&q=${encodeURIComponent(chunk)}`;
            const ttsRes = await fetch(ttsUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Referer: 'https://translate.google.com/',
              },
            });
            if (!ttsRes.ok) {
              throw new Error(`TTS HTTP ${ttsRes.status}`);
            }
            const buf = Buffer.from(await ttsRes.arrayBuffer());
            if (buf.byteLength < 256) {
              throw new Error('TTS returned empty audio chunk');
            }
            buffers.push(buf);
          }
          audioChunks = buffers;
          usedLang = tl;
          break;
        } catch {
          // Try next fallback language code
        }
      }

      if (!audioChunks || audioChunks.length === 0) {
        res.status(502).json({ error: 'Free AI voice server temporarily unreachable.' });
        return;
      }

      const combined = Buffer.concat(audioChunks);
      res.json({
        audioDataUrl: `data:audio/mpeg;base64,${combined.toString('base64')}`,
        mimeType: 'audio/mpeg',
        languageUsed: usedLang,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'TTS audio synthesis failed.';
      res.status(500).json({ error: msg });
    }
  });

  // 2d. AI Lip-Sync & Singing Photo SSE Endpoint (SadTalker / HallO / Wav2Lip)
  app.post('/api/generate/lip-sync', async (req, res) => {
    const { imageDataUrl, audioDataUrl, hfToken } = req.body as {
      imageDataUrl?: string;
      audioDataUrl?: string;
      hfToken?: string;
    };

    if (!imageDataUrl || !audioDataUrl) {
      res.status(400).json({ error: 'Portrait photo and audio track are both required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let aborted = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
      }
    });

    const sendEvent = (payload: unknown) => {
      if (aborted || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent({
      type: 'progress',
      percent: 12,
      message: 'Routing portrait + audio to Hugging Face Lip-Sync GPU...',
    });

    try {
      await generateLipSyncVideo({
        imageDataUrl,
        audioDataUrl,
        hfToken,
        isAborted: () => aborted,
        onEvent: (event) => {
          sendEvent(event);
        },
      });
    } catch (err) {
      if (!aborted) {
        sendEvent({
          type: 'busy',
          message: `Lip-Sync GPU busy (${
            err instanceof Error ? err.message : 'Queue unavailable'
          }) — switching to CineGen Smart Lip-Sync Animator...`,
        });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // 3. Test custom Colab / Hugging Face backend URL reachability
  app.post('/api/check-backend', async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url) {
        res.status(400).json({ ok: false, error: 'Backend URL is required.' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid URL format. Include https:// or http://' });
        return;
      }

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        res.status(400).json({ ok: false, error: 'Only HTTP and HTTPS backend URLs are supported.' });
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        res.json({
          ok: response.status < 500,
          status: response.status,
          message:
            response.status < 400
              ? `Endpoint responded (${response.status} OK).`
              : `Endpoint reachable (HTTP ${response.status}). Ready for POST requests.`,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : 'Unable to reach endpoint';
        res.status(502).json({ ok: false, error: `Could not connect: ${msg}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection test failed.';
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // 4. Custom Backend URL Video Generation Proxy (Colab / Hugging Face / FastAPI)
  app.post('/api/generate/video-proxy', async (req, res) => {
    try {
      const {
        backendUrl,
        mode,
        prompt,
        style,
        duration,
        aspectRatio,
        cameraMotion,
        quality,
        imageDataUrl,
      } = req.body as {
        backendUrl?: string;
        mode?: StudioMode;
        prompt?: string;
        style?: StylePreset;
        duration?: string;
        aspectRatio?: AspectRatio;
        cameraMotion?: string;
        quality?: '1080p' | '720p' | '4k';
        imageDataUrl?: string;
      };

      if (!backendUrl?.trim()) {
        res.status(400).json({ error: 'Custom backend URL is required.' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(backendUrl.trim());
      } catch {
        res.status(400).json({ error: 'Invalid backend URL. Enter a full https:// endpoint.' });
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      try {
        const upstreamResponse = await fetch(parsedUrl.toString(), {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, video/mp4, video/webm, */*',
          },
          body: JSON.stringify({
            mode,
            prompt,
            style,
            duration,
            aspectRatio,
            cameraMotion,
            quality,
            image: imageDataUrl ?? null,
          }),
        });
        clearTimeout(timeoutId);

        if (!upstreamResponse.ok) {
          const errText = await upstreamResponse.text().catch(() => '');
          res.status(502).json({
            error: `Custom backend returned HTTP ${upstreamResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`,
          });
          return;
        }

        const contentType = upstreamResponse.headers.get('content-type') || '';

        // Binary video stream returned directly
        if (contentType.startsWith('video/')) {
          const buf = Buffer.from(await upstreamResponse.arrayBuffer());
          const mime = contentType.split(';')[0];
          res.json({
            videoDataUrl: `data:${mime};base64,${buf.toString('base64')}`,
            mimeType: mime,
          });
          return;
        }

        const data = (await upstreamResponse.json()) as Record<string, unknown>;
        const directUrl =
          (typeof data.videoUrl === 'string' && data.videoUrl) ||
          (typeof data.video_url === 'string' && data.video_url) ||
          (typeof data.url === 'string' && data.url) ||
          (Array.isArray(data.data) && typeof data.data[0] === 'string' ? data.data[0] : null);

        if (directUrl) {
          if (directUrl.startsWith('data:video/')) {
            res.json({ videoDataUrl: directUrl, mimeType: 'video/mp4' });
            return;
          }
          // Fetch remote video URL through proxy so download & playback are CORS-safe
          const mediaRes = await fetch(directUrl);
          if (!mediaRes.ok) {
            res.json({ videoUrl: directUrl, mimeType: 'video/mp4' });
            return;
          }
          const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
          const mediaMime = mediaRes.headers.get('content-type')?.split(';')[0] || 'video/mp4';
          res.json({
            videoDataUrl: `data:${mediaMime};base64,${mediaBuf.toString('base64')}`,
            mimeType: mediaMime,
          });
          return;
        }

        const b64 =
          (typeof data.videoBase64 === 'string' && data.videoBase64) ||
          (typeof data.video_base64 === 'string' && data.video_base64);
        if (b64) {
          const normalized = b64.startsWith('data:') ? b64 : `data:video/mp4;base64,${b64}`;
          res.json({ videoDataUrl: normalized, mimeType: 'video/mp4' });
          return;
        }

        res.status(502).json({
          error:
            'Custom backend responded, but did not return a recognized video field (expected videoUrl, video_url, videoBase64, or binary video/mp4).',
        });
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : 'Upstream video request failed.';
        res.status(502).json({ error: `Backend request failed: ${msg}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Proxy error.';
      res.status(500).json({ error: msg });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Jatt CineGen AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
