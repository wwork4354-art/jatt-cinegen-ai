import { getVoiceLanguageById, type VoiceLanguageOption } from './voiceLanguages';

export type VoicePromptPhraseKey =
  | 'listeningStart'
  | 'promptEnhanced'
  | 'autoGeneratingIn2s'
  | 'autoGenCancelled'
  | 'generationStarted'
  | 'generationSuccess'
  | 'generationError'
  | 'filmListeningStart';

interface LocalizedVoiceConfirmations {
  listeningStart: string;
  promptEnhanced: string;
  autoGeneratingIn2s: string;
  autoGenCancelled: string;
  generationStarted: string;
  generationSuccess: string;
  generationError: string;
  filmListeningStart: string;
}

const CONFIRMATIONS_BY_LANG: Record<string, LocalizedVoiceConfirmations> = {
  en: {
    listeningStart: 'Listening now. Speak your scene or dialogue clearly.',
    promptEnhanced: 'Your voice has been turned into a detailed scene prompt.',
    autoGeneratingIn2s: 'Starting creation automatically in 2 seconds.',
    autoGenCancelled: 'Auto start cancelled. You can review your prompt.',
    generationStarted: 'Creating your video now. Please wait.',
    generationSuccess: 'Your creation is ready on screen.',
    generationError: 'Something went wrong. Please try again.',
    filmListeningStart: 'Listening for your dialogue line.',
  },
  ur: {
    listeningStart: 'اب بولیں، میں سن رہا ہوں۔',
    promptEnhanced: 'آپ کی آواز سے مکمل سین تیار کر دیا گیا ہے۔',
    autoGeneratingIn2s: 'دو سیکنڈ میں ویڈیو بننا شروع ہو جائے گی۔',
    autoGenCancelled: 'آٹو جنریٹ روک دیا گیا ہے۔',
    generationStarted: 'آپ کی ویڈیو تیار کی جا رہی ہے، براہ کرم انتظار کریں۔',
    generationSuccess: 'آپ کی ویڈیو تیار ہو چکی ہے۔',
    generationError: 'کوئی مسئلہ پیش آ گیا، براہ کرم دوبارہ کوشش کریں۔',
    filmListeningStart: 'اس کردار کا مکالمہ اب بولیں۔',
  },
  'pa-IN': {
    listeningStart: 'ਹੁਣ ਬੋਲੋ, ਮੈਂ ਸੁਣ ਰਿਹਾ ਹਾਂ।',
    promptEnhanced: 'ਤੁਹਾਡੀ ਆਵਾਜ਼ ਤੋਂ ਪੂਰਾ ਸੀਨ ਤਿਆਰ ਹੋ ਗਿਆ ਹੈ।',
    autoGeneratingIn2s: 'ਦੋ ਸਕਿੰਟਾਂ ਵਿੱਚ ਵੀਡੀਓ ਬਣਨੀ ਸ਼ੁਰੂ ਹੋ ਜਾਵੇਗੀ।',
    autoGenCancelled: 'ਆਟੋ ਜਨਰੇਟ ਰੋਕ ਦਿੱਤਾ ਗਿਆ ਹੈ।',
    generationStarted: 'ਤੁਹਾਡੀ ਵੀਡੀਓ ਤਿਆਰ ਹੋ ਰਹੀ ਹੈ, ਕਿਰਪਾ ਕਰਕੇ ਉਡੀਕ ਕਰੋ।',
    generationSuccess: 'ਤੁਹਾਡੀ ਵੀਡੀਓ ਹੁਣ ਤਿਆਰ ਹੈ।',
    generationError: 'ਕੋਈ ਸਮੱਸਿਆ ਆ ਗਈ ਹੈ, ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    filmListeningStart: 'ਇਸ ਕਿਰਦਾਰ ਦਾ ਡਾਇਲਾਗ ਹੁਣ ਬੋਲੋ।',
  },
  'pa-PK': {
    listeningStart: 'ہن بولو، میں سن رہیا ہاں۔',
    promptEnhanced: 'تہاڈی آواز نال مکمل سین تیار ہو گیا اے۔',
    autoGeneratingIn2s: 'دو سیکنڈ وچ ویڈیو بننی شروع ہو جاوے گی۔',
    autoGenCancelled: 'آٹو جنریٹ روک دتا گیا اے۔',
    generationStarted: 'تہاڈی ویڈیو تیار ہو رہی اے، مہربانی کرکے انتظار کرو۔',
    generationSuccess: 'تہاڈی ویڈیو تیار ہو گئی اے۔',
    generationError: 'کوئی مسئلہ آ گیا اے، دوبارہ کوشش کرو۔',
    filmListeningStart: 'اس کردار دا ڈائیلاگ ہن بولو۔',
  },
  'pa-FSD': {
    listeningStart: 'اوئے ہوئے! ہن بولو استاد جی، مائیک آن اے، چس کرا دیو!',
    promptEnhanced: 'واہ استاد! تہاڈی آواز نال ات چُک سین تیار ہو گیا اے، مزہ آ جاوے گا!',
    autoGeneratingIn2s: 'تیار ہو جاؤ استاد، دو سیکنڈ وچ ویڈیو پٹاخے وانگوں بنن لگ پئی اے!',
    autoGenCancelled: 'بریک لگ گئی استاد جی، آرام نال چیک کر لو۔',
    generationStarted: 'اوئے ہوئے، ویڈیو بنن لگی اے استاد، ذرا ساہ کڈھ کے بیٹھو!',
    generationSuccess: 'لو جی استاد! چس آ گئی، تہاڈی ویڈیو پکی تیار ہو گئی اے!',
    generationError: 'اوئے یار، تھوڑا رولا پے گیا اے، دوبارہ ٹرائی مارو استاد!',
    filmListeningStart: 'ایس کردار دا تگڑا جیا ڈائیلاگ بولو استاد، شغل لگے گا!',
  },
  sd: {
    listeningStart: 'هاڻي ڳالهايو، آئون ٻڌي رهيو آهيان.',
    promptEnhanced: 'توهان جي آواز مان مڪمل سين تيار ڪيو ويو آهي.',
    autoGeneratingIn2s: 'ٻن سيڪنڊن ۾ وڊيو ٺهڻ شروع ٿيندي.',
    autoGenCancelled: 'پاڻمرادو ٺاهڻ روڪيو ويو آهي.',
    generationStarted: 'توهان جي وڊيو تيار ٿي رهي آهي، مهرباني ڪري انتظار ڪريو.',
    generationSuccess: 'توهان جي وڊيو هاڻي تيار آهي.',
    generationError: 'ڪو مسئلو پيش آيو، مهرباني ڪري ٻيهر ڪوشش ڪريو.',
    filmListeningStart: 'هن ڪردار جو مڪالمو هاڻي ڳالهايو.',
  },
  ta: {
    listeningStart: 'இப்போது பேசுங்கள், நான் கேட்கிறேன்.',
    promptEnhanced: 'உங்கள் குரல் விரிவான காட்சியாக மாற்றப்பட்டது.',
    autoGeneratingIn2s: 'இரண்டு வினாடிகளில் உருவாக்கம் தொடங்கும்.',
    autoGenCancelled: 'தானியங்கி உருவாக்கம் நிறுத்தப்பட்டது.',
    generationStarted: 'உங்கள் வீடியோ இப்போது உருவாகிறது, தயவுசெய்து காத்திருக்கவும்.',
    generationSuccess: 'உங்கள் படைப்பு தயாராகிவிட்டது.',
    generationError: 'பிழை ஏற்பட்டது, மீண்டும் முயற்சிக்கவும்.',
    filmListeningStart: 'இந்த கதாபாத்திரத்தின் வசனத்தை இப்போது பேசுங்கள்.',
  },
  te: {
    listeningStart: 'ఇప్పుడు మాట్లాడండి, నేను వింటున్నాను.',
    promptEnhanced: 'మీ మాటలు పూర్తి సన్నివేశంగా మార్చబడ్డాయి.',
    autoGeneratingIn2s: 'రెండు సెకన్లలో వీడియో తయారీ ప్రారంభమవుతుంది.',
    autoGenCancelled: 'ఆటో జనరేషన్ నిలిపివేయబడింది.',
    generationStarted: 'మీ వీడియో తయారవుతోంది, దయచేసి వేచి ఉండండి.',
    generationSuccess: 'మీ వీడియో సిద్ధంగా ఉంది.',
    generationError: 'లోపం జరిగింది, దయచేసి మళ్లీ ప్రయత్నించండి.',
    filmListeningStart: 'ఈ పాత్ర సంభాషణను ఇప్పుడు మాట్లాడండి.',
  },
  hi: {
    listeningStart: 'अब बोलें, मैं सुन रहा हूँ।',
    promptEnhanced: 'आपकी आवाज़ से पूरा सीन तैयार कर दिया गया है।',
    autoGeneratingIn2s: 'दो सेकंड में वीडियो बनना शुरू हो जाएगा।',
    autoGenCancelled: 'ऑटो जनरेट रोक दिया गया है।',
    generationStarted: 'आपका वीडियो तैयार हो रहा है, कृपया प्रतीक्षा करें।',
    generationSuccess: 'आपका वीडियो बनकर तैयार है।',
    generationError: 'कोई समस्या आई है, कृपया फिर से प्रयास करें।',
    filmListeningStart: 'इस किरदार का डायलॉग अब बोलें।',
  },
  bn: {
    listeningStart: 'এখন বলুন, আমি শুনছি।',
    promptEnhanced: 'আপনার কথা থেকে বিস্তারিত দৃশ্য তৈরি হয়েছে।',
    autoGeneratingIn2s: 'দুই সেকেন্ডের মধ্যে তৈরি শুরু হবে।',
    autoGenCancelled: 'অটো তৈরি বাতিল করা হয়েছে।',
    generationStarted: 'আপনার ভিডিও তৈরি হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন।',
    generationSuccess: 'আপনার ভিডিও এখন তৈরি হয়ে গেছে।',
    generationError: 'সমস্যা হয়েছে, অনুগ্রহ করে আবার চেষ্টা করুন।',
    filmListeningStart: 'এই চরিত্রের সংলাপ এখন বলুন।',
  },
  ar: {
    listeningStart: 'تحدث الآن، أنا أستمع إليك.',
    promptEnhanced: 'تم تحويل كلامك إلى وصف مشهد مفصل.',
    autoGeneratingIn2s: 'سيبدأ الإنشاء تلقائيًا خلال ثانيتين.',
    autoGenCancelled: 'تم إيقاف الإنشاء التلقائي.',
    generationStarted: 'جاري إنشاء الفيديو الآن، يرجى الانتظار.',
    generationSuccess: 'تم الانتهاء من الإنشاء وهو جاهز الآن.',
    generationError: 'حدث خطأ، يرجى المحاولة مرة أخرى.',
    filmListeningStart: 'تحدث بجملة الحوار لهذا الشخص الآن.',
  },
  skr: {
    listeningStart: 'ہن بولو، میں سنیندا پیا ہاں۔',
    promptEnhanced: 'تہاڈی آواز نال مکمل سین تیار تھی گیا اے۔',
    autoGeneratingIn2s: 'ڈو سیکنڈ وچ ویڈیو بننا شروع تھی ویسی۔',
    autoGenCancelled: 'آٹو جنریٹ روک ڈتا گیا اے۔',
    generationStarted: 'تہاڈی ویڈیو تیار تھیندی پئی اے، انتظار کرو۔',
    generationSuccess: 'تہاڈی ویڈیو تیار تھی گئی اے۔',
    generationError: 'مسئلہ آ گیا اے، ولا کوشش کرو۔',
    filmListeningStart: 'اس کردار دا ڈائیلاگ ہن بولو۔',
  },
  ps: {
    listeningStart: 'اوس خبرې وکړئ، زه اورم.',
    promptEnhanced: 'ستاسو له غږ څخه بشپړه صحنه جوړه شوه.',
    autoGeneratingIn2s: 'په دوو ثانیو کې به ویډیو جوړېدل پیل شي.',
    autoGenCancelled: 'اتومات جوړول ودرول شو.',
    generationStarted: 'ستاسو ویډیو جوړېږي، مهرباني وکړئ انتظار وکړئ.',
    generationSuccess: 'ستاسو ویډیو چمتو ده.',
    generationError: 'ستونزه رامنځته شوه، بیا هڅه وکړئ.',
    filmListeningStart: 'د دې کرکټر خبره اوس ووایاست.',
  },
};

export function getVoiceConfirmationText(
  voiceLanguageId: string,
  key: VoicePromptPhraseKey
): string {
  const normalized = voiceLanguageId === 'pa' ? 'pa-IN' : voiceLanguageId;
  const table = CONFIRMATIONS_BY_LANG[normalized] ?? CONFIRMATIONS_BY_LANG.en;
  return table[key];
}

let activeAudioEl: HTMLAudioElement | null = null;
let speakGenerationToken = 0;

export function stopVoiceReadback(): void {
  speakGenerationToken += 1;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore synthesis cancel error
    }
  }
  if (activeAudioEl) {
    try {
      activeAudioEl.pause();
      activeAudioEl.src = '';
    } catch {
      // Ignore audio cleanup error
    }
    activeAudioEl = null;
  }
}

function findMatchingBrowserVoice(voiceLang: VoiceLanguageOption): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const prefix = voiceLang.translateHintCode.split('-')[0].toLowerCase();
    const exact = voices.find((v) => v.lang.toLowerCase() === voiceLang.speechCode.toLowerCase());
    if (exact) return exact;
    return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Speaks a confirmation/status message aloud in the user's selected language.
 * Uses native SpeechSynthesis when available for the target language, or seamlessly
 * fetches zero-key multilingual MP3 speech via /api/tts-audio so Urdu, Punjabi, Sindhi,
 * Tamil, Telugu, etc. are always spoken clearly aloud for non-readers.
 */
export async function speakVoiceConfirmation(
  voiceLanguageId: string,
  phraseOrText: VoicePromptPhraseKey | { customText: string }
): Promise<void> {
  if (typeof window === 'undefined') return;

  stopVoiceReadback();
  const token = speakGenerationToken;
  const voiceLang = getVoiceLanguageById(voiceLanguageId);
  const text =
    typeof phraseOrText === 'string'
      ? getVoiceConfirmationText(voiceLanguageId, phraseOrText)
      : phraseOrText.customText.trim();

  if (!text) return;

  const browserVoice = findMatchingBrowserVoice(voiceLang);
  if (browserVoice && 'speechSynthesis' in window) {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.voice = browserVoice;
      utter.lang = browserVoice.lang || voiceLang.speechCode;
      utter.rate = 0.98;
      window.speechSynthesis.speak(utter);
      return;
    } catch {
      // Fall back to /api/tts-audio
    }
  }

  try {
    const hasShahmukhiScript = /[\u0600-\u06FF]/.test(text);
    const resolvedTtsLang =
      (voiceLang.id === 'pa-PK' || voiceLang.id === 'pa-FSD' || hasShahmukhiScript) &&
      voiceLang.translateHintCode === 'pa'
        ? 'ur'
        : voiceLang.translateHintCode;
    const res = await fetch('/api/tts-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 260),
        languageCode: resolvedTtsLang,
      }),
    });
    if (token !== speakGenerationToken) return;
    if (res.ok) {
      const payload = (await res.json()) as { audioDataUrl?: string };
      if (payload.audioDataUrl && token === speakGenerationToken) {
        const audio = new Audio(payload.audioDataUrl);
        activeAudioEl = audio;
        audio.onended = () => {
          if (activeAudioEl === audio) activeAudioEl = null;
        };
        await audio.play().catch(() => {});
        return;
      }
    }
  } catch {
    // Fall back to generic browser speechSynthesis
  }

  if (token === speakGenerationToken && 'speechSynthesis' in window) {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = voiceLang.speechCode;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore fallback error
    }
  }
}
