import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

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

  // 1b. Expand a single prompt into 3 sequential scenes for 15s multi-scene video
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
        contents: `Break this single video idea into 3 connected sequential 5-second film scenes (Scene 1: Beginning, Scene 2: Action/Middle, Scene 3: Ending). Keep characters, setting, and lighting visually consistent across all 3 scenes. Prompt: "${cleanPrompt}". ${styleHint} ${cameraHint}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Exactly 3 sequential visual scene prompts under 45 words each.',
              },
            },
            required: ['scenes'],
          },
          systemInstruction:
            'You are a film director creating a 3-shot 15-second storyboard. Return exactly 3 vivid, cohesive scene prompts representing Beginning, Middle Action, and Ending payoff.',
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
        quality?: '1080p' | '720p';
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
