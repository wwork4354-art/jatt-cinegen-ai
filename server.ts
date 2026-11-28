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
import {
  buildVideoNegativePrompt,
  detectPersonOrCharacter,
  enhanceTextToVideoPromptFraming,
  isCloseUpRequested,
} from './shared/videoPromptFraming.ts';
import {
  isSafeMediaDataUrl,
  redactSecrets,
  validateExternalEndpointUrl,
  validateSafePromptAndScript,
} from './shared/securityShield.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

type StudioMode = 'text-to-image' | 'text-to-video' | 'image-to-video';
type AspectRatio = '16:9' | '9:16' | '1:1';
type StylePreset = 'realistic' | 'anime' | '3d-render' | 'cinematic' | 'none';

function getGeminiClient(overrideKey?: string): GoogleGenAI {
  const apiKey = (
    overrideKey?.trim() ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    ''
  ).trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a free-tier Gemini API key or Together AI key in Engine Settings to use Magic Enhance Prompt.'
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

async function callOpenAiCompatibleChat(params: {
  url: string;
  apiKey: string;
  models: string[];
  systemPrompt: string;
  userPrompt: string;
  extraHeaders?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  label: string;
}): Promise<string> {
  const {
    url,
    apiKey,
    models,
    systemPrompt,
    userPrompt,
    extraHeaders,
    maxTokens = 200,
    temperature = 0.7,
    label,
  } = params;
  let lastError = `${label} unavailable`;

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(extraHeaders ?? {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `${label} HTTP ${res.status}`;
        if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
          throw new Error(lastError);
        }
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = (data.choices?.[0]?.message?.content ?? '')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (text) return text;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : lastError;
      if (
        lastError.includes('401') ||
        lastError.includes('402') ||
        lastError.includes('403') ||
        lastError.includes('429')
      ) {
        throw new Error(lastError);
      }
    }
  }

  throw new Error(lastError);
}

async function enhancePromptWithGroq(params: {
  groqKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return callOpenAiCompatibleChat({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: params.groqKey,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    label: 'Groq AI',
  });
}

async function enhancePromptWithOpenRouter(params: {
  openRouterKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return callOpenAiCompatibleChat({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: params.openRouterKey,
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
    ],
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    extraHeaders: {
      'X-Title': 'Jatt CineGen AI',
    },
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    label: 'OpenRouter AI',
  });
}

async function enhancePromptWithTogetherAi(params: {
  togetherKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return callOpenAiCompatibleChat({
    url: 'https://api.together.ai/v1/chat/completions',
    apiKey: params.togetherKey,
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    ],
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    label: 'Together AI',
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
  return { status: 500, message: redactSecrets(raw) || 'Unexpected server error.' };
}

const ipRateBuckets = new Map<string, number[]>();
const API_RATE_WINDOW_MS = 60_000;
const API_RATE_MAX_HITS = 35;

function enforceApiRateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const forwarded = typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : '';
  const clientIp = forwarded || req.ip || 'unknown';
  const now = Date.now();
  const prev = ipRateBuckets.get(clientIp) ?? [];
  const active = prev.filter((ts) => now - ts < API_RATE_WINDOW_MS);

  if (active.length >= API_RATE_MAX_HITS) {
    const oldest = active[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + API_RATE_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: `Rate limit exceeded. Too many AI requests from this client — retry in ${retryAfter}s.`,
    });
    return;
  }

  active.push(now);
  ipRateBuckets.set(clientIp, active);
  if (ipRateBuckets.size > 2000) {
    for (const [key, list] of ipRateBuckets.entries()) {
      if (list.every((ts) => now - ts >= API_RATE_WINDOW_MS)) {
        ipRateBuckets.delete(key);
      }
    }
  }
  next();
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.run.app http://localhost:*"
    );
    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(
    [
      '/api/enhance-prompt',
      '/api/translate-prompt',
      '/api/transcribe-audio',
      '/api/expand-scenes',
      '/api/generate',
      '/api/tts-audio',
      '/api/check-backend',
    ],
    enforceApiRateLimit
  );

  // 1. Magic Enhance Prompt using Gemini -> Groq (llama-3.3-70b-versatile) -> OpenRouter (free models) -> Together AI
  app.post('/api/enhance-prompt', async (req, res) => {
    try {
      const { prompt, mode, style, cameraMotion, geminiKey, groqKey, openRouterKey, togetherKey } =
        req.body as {
          prompt?: string;
          mode?: StudioMode | 'lip-sync';
          style?: StylePreset;
          cameraMotion?: string;
          geminiKey?: string;
          groqKey?: string;
          openRouterKey?: string;
          togetherKey?: string;
        };

      const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
      if (!promptCheck.safe) {
        res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
        return;
      }
      const cleanPrompt = promptCheck.sanitized.trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Please enter a starting idea before enhancing.' });
        return;
      }

      const isLipSync = mode === 'lip-sync';
      const targetFormat = isLipSync
        ? 'a natural, expressive spoken dialogue or song verse (under 45 words) for a talking-portrait video'
        : mode === 'text-to-image'
        ? 'a single high-resolution still photograph or artwork'
        : mode === 'image-to-video'
        ? 'animating a reference image with natural subject movement and camera motion'
        : 'a cohesive cinematic video clip';

      const styleHint = !isLipSync && style && style !== 'none' ? `Target visual style: ${style}.` : '';
      const cameraHint =
        !isLipSync && cameraMotion && mode !== 'text-to-image'
          ? `Desired camera movement: ${cameraMotion}.`
          : '';

      const characterFramingRule =
        !isLipSync &&
        mode !== 'text-to-image' &&
        detectPersonOrCharacter(cleanPrompt) &&
        !isCloseUpRequested(cleanPrompt)
          ? ' Because the scene includes a person or character without a close-up request, include full-body framing from head to toe, wide angle, front-facing view, clear detailed face, and both arms and hands clearly visible.'
          : '';

      const systemPrompt = isLipSync
        ? 'You are a script and dialogue writer. Rewrite or expand the user input into one natural, expressive spoken script or short song verse under 45 words in the same language as the input. Return ONLY the script text with no quotes or markdown.'
        : `You are an expert cinematography and visual prompt director. Rewrite the user input into one vivid, cohesive, production-ready prompt under 75 words. Focus on concrete visual subjects, lighting, atmosphere, lens/texture details, and natural motion when video is requested.${characterFramingRule} Return ONLY the enhanced prompt text with no quotes, no preamble, and no markdown.`;
      const userPrompt = `Enhance this creative prompt for ${targetFormat}: "${cleanPrompt}". ${styleHint} ${cameraHint}`.trim();

      const resolvedGroqKey = (
        groqKey?.trim() ||
        process.env.VITE_GROQ_API_KEY ||
        process.env.GROQ_API_KEY ||
        ''
      ).trim();
      const resolvedOpenRouterKey = (
        openRouterKey?.trim() ||
        process.env.VITE_OPENROUTER_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        ''
      ).trim();
      const resolvedTogetherKey = (
        togetherKey?.trim() ||
        process.env.VITE_TOGETHER_API_KEY ||
        process.env.TOGETHER_API_KEY ||
        ''
      ).trim();

      let enhancedPrompt = '';
      let lastError: unknown = null;

      try {
        const ai = getGeminiClient(geminiKey);
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userPrompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction: systemPrompt,
          },
        });
        enhancedPrompt = (response.text ?? '').trim().replace(/^["']|["']$/g, '');
      } catch (err) {
        lastError = err;
      }

      if (!enhancedPrompt && resolvedGroqKey) {
        try {
          enhancedPrompt = await enhancePromptWithGroq({
            groqKey: resolvedGroqKey,
            systemPrompt,
            userPrompt,
            maxTokens: 180,
            temperature: 0.7,
          });
        } catch (err) {
          lastError = err;
        }
      }

      if (!enhancedPrompt && resolvedOpenRouterKey) {
        try {
          enhancedPrompt = await enhancePromptWithOpenRouter({
            openRouterKey: resolvedOpenRouterKey,
            systemPrompt,
            userPrompt,
            maxTokens: 180,
            temperature: 0.7,
          });
        } catch (err) {
          lastError = err;
        }
      }

      if (!enhancedPrompt && resolvedTogetherKey) {
        try {
          enhancedPrompt = await enhancePromptWithTogetherAi({
            togetherKey: resolvedTogetherKey,
            systemPrompt,
            userPrompt,
            maxTokens: 180,
            temperature: 0.7,
          });
        } catch (err) {
          lastError = err;
        }
      }

      if (!enhancedPrompt) {
        if (lastError) throw lastError;
        throw new Error('Model returned an empty prompt enhancement.');
      }

      if (mode === 'text-to-video' || !mode) {
        enhancedPrompt = enhanceTextToVideoPromptFraming(enhancedPrompt);
      }

      res.json({ enhancedPrompt });
    } catch (error) {
      const parsed = parseGeminiErrorMessage(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 1b. Translate multilingual voice/text prompt into vivid English (Gemini -> Groq Llama -> OpenRouter -> Google GTX)
  app.post('/api/translate-prompt', async (req, res) => {
    try {
      const { prompt, sourceLanguage, translateHintCode, geminiKey, groqKey, openRouterKey } =
        req.body as {
          prompt?: string;
          sourceLanguage?: string;
          translateHintCode?: string;
          geminiKey?: string;
          groqKey?: string;
          openRouterKey?: string;
        };

      const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
      if (!promptCheck.safe) {
        res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
        return;
      }
      const cleanPrompt = promptCheck.sanitized.trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const hasNonAscii = /[^\x20-\x7E\r\n\t]/.test(cleanPrompt);
      if (!hasNonAscii && (!sourceLanguage || sourceLanguage === 'English')) {
        res.json({ translatedPrompt: cleanPrompt, wasTranslated: false });
        return;
      }

      const langNote = sourceLanguage ? ` (spoken/written in ${sourceLanguage})` : '';
      const sysPrompt =
        'You are a multilingual translator specializing in South Asian, Middle Eastern, East Asian, and European languages (including Urdu, Punjabi, Saraiki, Pashto, Balochi, Sindhi, Tamil, Telugu, Hindi, Bengali, Persian, Arabic, Marathi, Sanskrit, Russian, Chinese). Translate accurately to natural descriptive English. Return ONLY the translated English text.';
      const usrPrompt = `Translate this visual image/video generation prompt${langNote} into clear, vivid, natural English suitable for an AI image/video generator. If it is already English, refine grammar slightly without losing any meaning. Return ONLY the English prompt with no quotes or explanation:\n\n${cleanPrompt}`;

      if (geminiKey?.trim() || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY) {
        try {
          const ai = getGeminiClient(geminiKey);
          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: usrPrompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction: sysPrompt,
            },
          });

          const translated = (response.text ?? '').trim().replace(/^["']|["']$/g, '');
          if (translated) {
            res.json({ translatedPrompt: translated, wasTranslated: translated !== cleanPrompt });
            return;
          }
        } catch {
          // Fall through to Groq / OpenRouter / Google GTX
        }
      }

      const resolvedGroqKey = (
        groqKey?.trim() ||
        process.env.VITE_GROQ_API_KEY ||
        process.env.GROQ_API_KEY ||
        ''
      ).trim();
      if (resolvedGroqKey) {
        try {
          const translated = await enhancePromptWithGroq({
            groqKey: resolvedGroqKey,
            systemPrompt: sysPrompt,
            userPrompt: usrPrompt,
            maxTokens: 220,
            temperature: 0.2,
          });
          if (translated) {
            res.json({ translatedPrompt: translated, wasTranslated: translated !== cleanPrompt });
            return;
          }
        } catch {
          // Fall through to OpenRouter
        }
      }

      const resolvedOpenRouterKey = (
        openRouterKey?.trim() ||
        process.env.VITE_OPENROUTER_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        ''
      ).trim();
      if (resolvedOpenRouterKey) {
        try {
          const translated = await enhancePromptWithOpenRouter({
            openRouterKey: resolvedOpenRouterKey,
            systemPrompt: sysPrompt,
            userPrompt: usrPrompt,
            maxTokens: 220,
            temperature: 0.2,
          });
          if (translated) {
            res.json({ translatedPrompt: translated, wasTranslated: translated !== cleanPrompt });
            return;
          }
        } catch {
          // Fall through to free zero-key Google Translate GTX
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
        if (Array.isArray(gtxData) && Array.isArray(gtxData[0])) {
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

  // 1b-2. Groq Whisper Voice Transcription (whisper-large-v3-turbo)
  app.post('/api/transcribe-audio', async (req, res) => {
    try {
      const { audioBase64, mimeType, languageCode, groqKey } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        languageCode?: string;
        groqKey?: string;
      };

      const cleanBase64 = (audioBase64 || '').trim();
      if (!cleanBase64) {
        res.status(400).json({ error: 'Audio recording data is required.' });
        return;
      }

      const apiKey = (
        groqKey?.trim() ||
        process.env.VITE_GROQ_API_KEY ||
        process.env.GROQ_API_KEY ||
        ''
      ).trim();
      if (!apiKey) {
        res.status(400).json({ error: 'Groq Free API Key is not configured.' });
        return;
      }

      const rawBase64 = cleanBase64.includes(',') ? cleanBase64.split(',')[1] || '' : cleanBase64;
      const audioBuffer = Buffer.from(rawBase64, 'base64');
      if (audioBuffer.byteLength < 256) {
        res.status(400).json({ error: 'Recorded audio was too short.' });
        return;
      }

      const safeMime = (mimeType || 'audio/webm').split(';')[0].trim();
      const ext = safeMime.includes('mp4') || safeMime.includes('m4a') ? 'm4a' : safeMime.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer], { type: safeMime }), `voice.${ext}`);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'json');
      const shortLang = (languageCode || '').split('-')[0].trim().toLowerCase();
      if (shortLang && shortLang !== 'auto' && shortLang.length === 2) {
        formData.append('language', shortLang);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });
      clearTimeout(timer);

      if (!groqRes.ok) {
        let errDetail = `Groq Whisper HTTP ${groqRes.status}`;
        try {
          const errJson = (await groqRes.json()) as { error?: { message?: string } };
          if (errJson.error?.message) errDetail = errJson.error.message;
        } catch {
          // Ignore parse error
        }
        res.status(groqRes.status).json({ error: errDetail });
        return;
      }

      const data = (await groqRes.json()) as { text?: string };
      res.json({ text: (data.text || '').trim() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Whisper transcription failed.' });
    }
  });

  // 1c. Expand a single prompt into 3 sequential scenes for 15s multi-scene video
  app.post('/api/expand-scenes', async (req, res) => {
    try {
      const { prompt, style, cameraMotion, geminiKey, groqKey, openRouterKey } = req.body as {
        prompt?: string;
        style?: StylePreset;
        cameraMotion?: string;
        geminiKey?: string;
        groqKey?: string;
        openRouterKey?: string;
      };

      const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
      if (!promptCheck.safe) {
        res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
        return;
      }
      const cleanPrompt = promptCheck.sanitized.trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const styleHint = style && style !== 'none' ? `Visual style: ${style}.` : '';
      const cameraHint = cameraMotion ? `Camera feel: ${cameraMotion}.` : '';

      const needsFullBody =
        detectPersonOrCharacter(cleanPrompt) && !isCloseUpRequested(cleanPrompt);
      const framingNote = needsFullBody
        ? ' Keep every scene framed as a wide-angle full body shot from head to toe facing forward with clear detailed face and both arms and hands clearly visible.'
        : '';

      const systemInstr =
        'You are a film director creating a 3-shot 15-second storyboard. Always output the 3 scene prompts in vivid descriptive English (translate if the input prompt is in another language) representing Beginning, Middle Action, and Ending payoff.';
      const userInstr = `Break this single video idea into 3 connected sequential 5-second film scenes in clear descriptive English (Scene 1: Beginning, Scene 2: Action/Middle, Scene 3: Ending). Keep characters, setting, and lighting visually consistent across all 3 scenes.${framingNote} Prompt: "${cleanPrompt}". ${styleHint} ${cameraHint}`;

      let scenes: string[] | null = null;
      let lastError: unknown = null;

      try {
        const ai = getGeminiClient(geminiKey);
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userInstr,
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
            systemInstruction: systemInstr,
          },
        });
        const parsed = JSON.parse((response.text ?? '{}').trim()) as { scenes?: string[] };
        if (Array.isArray(parsed.scenes) && parsed.scenes.length >= 3) {
          scenes = parsed.scenes;
        }
      } catch (err) {
        lastError = err;
      }

      const resolvedGroqKey = (
        groqKey?.trim() ||
        process.env.VITE_GROQ_API_KEY ||
        process.env.GROQ_API_KEY ||
        ''
      ).trim();
      const resolvedOpenRouterKey = (
        openRouterKey?.trim() ||
        process.env.VITE_OPENROUTER_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        ''
      ).trim();

      if (!scenes && (resolvedGroqKey || resolvedOpenRouterKey)) {
        const jsonPrompt = `${userInstr}\n\nRespond strictly with JSON object: {"scenes":["scene 1","scene 2","scene 3"]}`;
        try {
          const rawJson = resolvedGroqKey
            ? await enhancePromptWithGroq({
                groqKey: resolvedGroqKey,
                systemPrompt: systemInstr,
                userPrompt: jsonPrompt,
                maxTokens: 320,
              })
            : await enhancePromptWithOpenRouter({
                openRouterKey: resolvedOpenRouterKey,
                systemPrompt: systemInstr,
                userPrompt: jsonPrompt,
                maxTokens: 320,
              });
          const match = rawJson.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]) as { scenes?: string[] };
            if (Array.isArray(parsed.scenes) && parsed.scenes.length >= 3) {
              scenes = parsed.scenes;
            }
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!scenes || scenes.length < 3) {
        if (lastError) throw lastError;
        throw new Error('Could not generate 3 sequential scenes.');
      }

      const framedScenes = scenes
        .slice(0, 3)
        .map((scene) => (needsFullBody ? enhanceTextToVideoPromptFraming(scene) : scene));

      res.json({ scenes: framedScenes });
    } catch (error) {
      const parsed = parseGeminiErrorMessage(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 1d. Together AI Image Generation Proxy (black-forest-labs/FLUX.1-schnell-Free)
  app.post('/api/generate/together-image', async (req, res) => {
    try {
      const { prompt, width, height, togetherKey } = req.body as {
        prompt?: string;
        width?: number;
        height?: number;
        togetherKey?: string;
      };

      const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
      if (!promptCheck.safe) {
        res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
        return;
      }
      const cleanPrompt = promptCheck.sanitized.trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const apiKey = (
        togetherKey?.trim() ||
        process.env.VITE_TOGETHER_API_KEY ||
        process.env.TOGETHER_API_KEY ||
        ''
      ).trim();

      if (!apiKey) {
        res.status(400).json({ error: 'Together AI key is not configured.' });
        return;
      }

      const safeWidth = Math.min(1440, Math.max(256, Number(width) || 1024));
      const safeHeight = Math.min(1440, Math.max(256, Number(height) || 576));
      const models = ['black-forest-labs/FLUX.1-schnell-Free', 'black-forest-labs/FLUX.1-schnell'];
      let lastStatus = 502;
      let lastError = 'Together AI FLUX image generation failed';

      for (const model of models) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);
        try {
          const upstream = await fetch('https://api.together.ai/v1/images/generations', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              prompt: cleanPrompt,
              width: safeWidth,
              height: safeHeight,
              steps: 4,
              n: 1,
              response_format: 'b64_json',
            }),
          });
          clearTimeout(timer);

          if (!upstream.ok) {
            lastStatus = upstream.status;
            lastError = `Together AI (${model}) HTTP ${upstream.status}`;
            if (upstream.status === 401 || upstream.status === 402 || upstream.status === 403 || upstream.status === 429) {
              break;
            }
            continue;
          }

          const payload = (await upstream.json()) as {
            data?: Array<{ b64_json?: string; url?: string }>;
          };
          const first = payload.data?.[0];
          if (first?.b64_json) {
            res.json({
              imageDataUrl: `data:image/jpeg;base64,${first.b64_json}`,
              mimeType: 'image/jpeg',
              modelUsed: model,
              width: safeWidth,
              height: safeHeight,
            });
            return;
          }
          if (first?.url && first.url.startsWith('https://')) {
            const parsedImgUrl = new URL(first.url);
            const imgHost = parsedImgUrl.hostname.toLowerCase();
            const isPrivateHost =
              imgHost === 'localhost' ||
              imgHost === '127.0.0.1' ||
              imgHost === '::1' ||
              imgHost.startsWith('10.') ||
              imgHost.startsWith('192.168.') ||
              imgHost.startsWith('169.254.') ||
              /^172\.(1[6-9]|2\d|3[0-1])\./.test(imgHost);
            if (!isPrivateHost) {
              const imgRes = await fetch(parsedImgUrl.toString());
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                const mime = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
                res.json({
                  imageDataUrl: `data:${mime};base64,${buf.toString('base64')}`,
                  mimeType: mime,
                  modelUsed: model,
                  width: safeWidth,
                  height: safeHeight,
                });
                return;
              }
            }
          }
          lastError = `${model} returned empty image data`;
        } catch (err) {
          clearTimeout(timer);
          lastError = err instanceof Error ? err.message : lastError;
        }
      }

      res.status(lastStatus >= 400 ? lastStatus : 502).json({ error: lastError });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Together AI proxy error' });
    }
  });

  // 2. Smart Multi-Engine Video Router (SiliconFlow -> HF Inference -> Agnes -> Fal.ai -> Replicate -> Veo -> Live HF Spaces -> Pollinations)
  app.post('/api/generate/hf-video', async (req, res) => {
    const {
      prompt,
      mode,
      aspectRatio,
      style,
      duration,
      seed,
      imageDataUrl,
      geminiKey,
      hfToken,
      siliconFlowKey,
      pollinationsKey,
      agnesKey,
      falKey,
      replicateToken,
      digenKey,
    } = req.body as {
      prompt?: string;
      mode?: HfVideoMode;
      aspectRatio?: HfAspectRatio;
      style?: StylePreset;
      duration?: '5s' | '10s' | '15s';
      seed?: number;
      imageDataUrl?: string;
      geminiKey?: string;
      hfToken?: string;
      siliconFlowKey?: string;
      pollinationsKey?: string;
      agnesKey?: string;
      falKey?: string;
      replicateToken?: string;
      digenKey?: string;
    };

    const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
    if (!promptCheck.safe) {
      res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
      return;
    }
    const cleanPrompt = promptCheck.sanitized.trim();
    if (!cleanPrompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }
    if (imageDataUrl && !isSafeMediaDataUrl(imageDataUrl, 'image')) {
      res.status(400).json({ error: 'Unsupported or unsafe image format. Only PNG, JPG, and WebP are allowed.' });
      return;
    }

    const safeMode: HfVideoMode = mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
    const safeRatio: HfAspectRatio =
      aspectRatio === '9:16' || aspectRatio === '1:1' ? aspectRatio : '16:9';
    const safeDuration = duration === '10s' || duration === '15s' ? duration : '5s';
    const safeSeed = typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : undefined;

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

    const framedPrompt =
      safeMode === 'text-to-video'
        ? enhanceTextToVideoPromptFraming(cleanPrompt)
        : cleanPrompt;
    const fullPrompt = styleSuffix ? `${framedPrompt}, ${styleSuffix}` : framedPrompt;
    const negativePrompt = buildVideoNegativePrompt(framedPrompt);

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
      message:
        safeMode === 'image-to-video'
          ? 'Routing photo to real Image-to-Video AI model...'
          : 'Routing to real Text-to-Video AI model (Wan 2.1 / CogVideoX / LTX-Video)...',
    });

    let routeTimer: NodeJS.Timeout | undefined;
    try {
      const routeTimeout = new Promise<never>((_, reject) => {
        routeTimer = setTimeout(() => {
          aborted = true;
          reject(new Error('68-second video generation timeout reached'));
        }, 68000);
      });

      await Promise.race([
        generateSmartMultiEngineVideo({
          prompt: fullPrompt,
          negativePrompt,
          mode: safeMode,
          aspectRatio: safeRatio,
          duration: safeDuration,
          seed: safeSeed,
          imageDataUrl,
          publicOrigin,
          geminiKey,
          hfToken,
          siliconFlowKey,
          pollinationsKey,
          agnesKey,
          falKey,
          replicateToken,
          digenKey,
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
              ? redactSecrets(err.message)
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

      const textCheck = validateSafePromptAndScript(text || '', 'Dialogue script');
      if (!textCheck.safe) {
        res.status(400).json({ error: textCheck.reason || 'Blocked unsafe dialogue text.' });
        return;
      }
      const cleanText = textCheck.sanitized.trim().replace(/\s+/g, ' ');
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

  // 2d. AI Lip-Sync & Singing Photo SSE Endpoint (Digen AI / SadTalker / HallO / Wav2Lip / Replicate SadTalker)
  app.post('/api/generate/lip-sync', async (req, res) => {
    const { imageDataUrl, audioDataUrl, hfToken, replicateToken, digenKey } = req.body as {
      imageDataUrl?: string;
      audioDataUrl?: string;
      hfToken?: string;
      replicateToken?: string;
      digenKey?: string;
    };

    if (!imageDataUrl || !audioDataUrl) {
      res.status(400).json({ error: 'Portrait photo and audio track are both required.' });
      return;
    }
    if (!isSafeMediaDataUrl(imageDataUrl, 'image') || !isSafeMediaDataUrl(audioDataUrl, 'audio')) {
      res.status(400).json({
        error: 'Blocked unsupported media format. Only PNG/JPG/WebP portraits and MP3/WAV/M4A/OGG audio are accepted.',
      });
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
      message: 'Routing portrait + audio to AI Lip-Sync Engine...',
    });

    try {
      await generateLipSyncVideo({
        imageDataUrl,
        audioDataUrl,
        hfToken,
        replicateToken,
        digenKey,
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

      const check = validateExternalEndpointUrl(url);
      if (!check.valid || !check.parsed) {
        res.status(400).json({ ok: false, error: check.reason || 'Invalid URL.' });
        return;
      }
      const parsedUrl = check.parsed;

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
        const msg = err instanceof Error ? redactSecrets(err.message) : 'Unable to reach endpoint';
        res.status(502).json({ ok: false, error: `Could not connect: ${msg}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? redactSecrets(error.message) : 'Connection test failed.';
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

      const urlCheck = validateExternalEndpointUrl(backendUrl);
      if (!urlCheck.valid || !urlCheck.parsed) {
        res.status(400).json({ error: urlCheck.reason || 'Invalid backend URL.' });
        return;
      }
      const parsedUrl = urlCheck.parsed;

      const promptCheck = validateSafePromptAndScript(prompt || '', 'Prompt');
      if (!promptCheck.safe) {
        res.status(400).json({ error: promptCheck.reason || 'Blocked unsafe prompt.' });
        return;
      }
      if (imageDataUrl && !isSafeMediaDataUrl(imageDataUrl, 'image')) {
        res.status(400).json({ error: 'Unsupported or unsafe image format.' });
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
