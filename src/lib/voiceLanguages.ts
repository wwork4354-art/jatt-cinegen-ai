export interface VoiceLanguageOption {
  id: string;
  speechCode: string;
  fallbackCodes: string[];
  nativeLabel: string;
  englishName: string;
  translateHintCode: string;
  isQuickPill: boolean;
}

export const VOICE_LANGUAGES: VoiceLanguageOption[] = [
  // 8 Primary Quick Pills
  {
    id: 'en',
    speechCode: 'en-US',
    fallbackCodes: ['en-GB'],
    nativeLabel: 'EN',
    englishName: 'English',
    translateHintCode: 'en',
    isQuickPill: true,
  },
  {
    id: 'ur',
    speechCode: 'ur-PK',
    fallbackCodes: ['ur-IN'],
    nativeLabel: 'اردو',
    englishName: 'Urdu',
    translateHintCode: 'ur',
    isQuickPill: true,
  },
  {
    id: 'pa',
    speechCode: 'pa-IN',
    fallbackCodes: ['pa-Guru-IN', 'hi-IN'],
    nativeLabel: 'ਪੰਜਾਬੀ',
    englishName: 'Punjabi',
    translateHintCode: 'pa',
    isQuickPill: true,
  },
  {
    id: 'hi',
    speechCode: 'hi-IN',
    fallbackCodes: [],
    nativeLabel: 'हिन्दी',
    englishName: 'Hindi',
    translateHintCode: 'hi',
    isQuickPill: true,
  },
  {
    id: 'skr',
    speechCode: 'skr-PK',
    fallbackCodes: ['ur-PK', 'pa-IN'],
    nativeLabel: 'سرائیکی',
    englishName: 'Saraiki',
    translateHintCode: 'ur',
    isQuickPill: true,
  },
  {
    id: 'ps',
    speechCode: 'ps-AF',
    fallbackCodes: ['ps-PK', 'fa-IR', 'ur-PK'],
    nativeLabel: 'پښتو',
    englishName: 'Pashto',
    translateHintCode: 'ps',
    isQuickPill: true,
  },
  {
    id: 'bal',
    speechCode: 'bal-PK',
    fallbackCodes: ['ur-PK', 'fa-IR'],
    nativeLabel: 'بلوچی',
    englishName: 'Balochi',
    translateHintCode: 'fa',
    isQuickPill: true,
  },
  {
    id: 'bn',
    speechCode: 'bn-BD',
    fallbackCodes: ['bn-IN'],
    nativeLabel: 'বাংলা',
    englishName: 'Bangla / Bengali',
    translateHintCode: 'bn',
    isQuickPill: true,
  },

  // 7 Additional Languages in "+ More Languages" Selector
  {
    id: 'fa',
    speechCode: 'fa-IR',
    fallbackCodes: [],
    nativeLabel: 'فارسی',
    englishName: 'Farsi / Persian',
    translateHintCode: 'fa',
    isQuickPill: false,
  },
  {
    id: 'ar',
    speechCode: 'ar-SA',
    fallbackCodes: ['ar-AE', 'ar-EG'],
    nativeLabel: 'العربية',
    englishName: 'Arabic',
    translateHintCode: 'ar',
    isQuickPill: false,
  },
  {
    id: 'ru',
    speechCode: 'ru-RU',
    fallbackCodes: [],
    nativeLabel: 'Русский',
    englishName: 'Russian',
    translateHintCode: 'ru',
    isQuickPill: false,
  },
  {
    id: 'zh',
    speechCode: 'zh-CN',
    fallbackCodes: ['zh-TW'],
    nativeLabel: '中文',
    englishName: 'Chinese',
    translateHintCode: 'zh-CN',
    isQuickPill: false,
  },
  {
    id: 'ta',
    speechCode: 'ta-IN',
    fallbackCodes: [],
    nativeLabel: 'தமிழ்',
    englishName: 'Tamil',
    translateHintCode: 'ta',
    isQuickPill: false,
  },
  {
    id: 'mr',
    speechCode: 'mr-IN',
    fallbackCodes: ['hi-IN'],
    nativeLabel: 'मराठी',
    englishName: 'Marathi',
    translateHintCode: 'mr',
    isQuickPill: false,
  },
  {
    id: 'sa',
    speechCode: 'sa-IN',
    fallbackCodes: ['hi-IN'],
    nativeLabel: 'संस्कृतम्',
    englishName: 'Sanskrit',
    translateHintCode: 'sa',
    isQuickPill: false,
  },
];

export const QUICK_VOICE_LANGUAGES = VOICE_LANGUAGES.filter((l) => l.isQuickPill);
export const MORE_VOICE_LANGUAGES = VOICE_LANGUAGES.filter((l) => !l.isQuickPill);

export function getVoiceLanguageById(id: string): VoiceLanguageOption {
  return VOICE_LANGUAGES.find((l) => l.id === id) ?? VOICE_LANGUAGES[0];
}

export async function translatePromptToEnglish(
  rawPrompt: string,
  sourceLanguageId?: string
): Promise<{ englishPrompt: string; wasTranslated: boolean }> {
  const trimmed = rawPrompt.trim();
  if (!trimmed) return { englishPrompt: '', wasTranslated: false };

  const hasNonAscii = /[^\x20-\x7E\r\n\t]/.test(trimmed);
  const langMeta = sourceLanguageId ? getVoiceLanguageById(sourceLanguageId) : undefined;
  const shouldTranslate = hasNonAscii || (langMeta && langMeta.id !== 'en');

  if (!shouldTranslate) {
    return { englishPrompt: trimmed, wasTranslated: false };
  }

  try {
    const res = await fetch('/api/translate-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: trimmed,
        sourceLanguage: langMeta?.englishName,
        translateHintCode: langMeta?.translateHintCode ?? 'auto',
      }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json()) as {
        translatedPrompt?: string;
        wasTranslated?: boolean;
      };
      if (data.translatedPrompt && data.translatedPrompt.trim()) {
        return {
          englishPrompt: data.translatedPrompt.trim(),
          wasTranslated: Boolean(data.wasTranslated),
        };
      }
    }
  } catch {
    // Fall back safely to original prompt if translation endpoint is offline
  }

  return { englishPrompt: trimmed, wasTranslated: false };
}
