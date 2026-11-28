export type LanguageCode =
  | 'en'
  | 'ur'
  | 'pa'
  | 'hi'
  | 'ar'
  | 'es'
  | 'fr'
  | 'de'
  | 'tr'
  | 'ru'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'sd'
  | 'ta'
  | 'te';

export interface LanguageOption {
  code: LanguageCode;
  name: string;
  nativeName: string;
  speechLocale: string;
  rtl?: boolean;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', speechLocale: 'en-US' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', speechLocale: 'ur-PK', rtl: true },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', speechLocale: 'pa-IN' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', speechLocale: 'hi-IN' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', speechLocale: 'ar-SA', rtl: true },
  { code: 'es', name: 'Spanish', nativeName: 'Español', speechLocale: 'es-ES' },
  { code: 'fr', name: 'French', nativeName: 'Français', speechLocale: 'fr-FR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', speechLocale: 'de-DE' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', speechLocale: 'tr-TR' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', speechLocale: 'ru-RU' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', speechLocale: 'zh-CN' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', speechLocale: 'ja-JP' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', speechLocale: 'ko-KR' },
  { code: 'sd', name: 'Sindhi', nativeName: 'سنڌي', speechLocale: 'sd-PK', rtl: true },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', speechLocale: 'ta-IN' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', speechLocale: 'te-IN' },
];

export interface UIStrings {
  navTextToVideo: string;
  navImageToVideo: string;
  navLipSync: string;
  navFilmDirector: string;
  navTextToImage: string;
  navLifetimeFree: string;
  navMyCreations: string;
  newCanvas: string;
  languageLabel: string;
  promptLabel: string;
  promptPlaceholderVideo: string;
  promptPlaceholderImage: string;
  promptPlaceholderAnimate: string;
  magicEnhance: string;
  enhancing: string;
  aspectRatio: string;
  ratioWide: string;
  ratioVertical: string;
  ratioSquare: string;
  stylePreset: string;
  duration: string;
  renderQuality: string;
  fastMode: string;
  fullHdMode: string;
  ultraHd: string;
  cameraMotion: string;
  voiceoverLabel: string;
  voiceoverHint: string;
  musicLabel: string;
  musicUpload: string;
  musicRemove: string;
  generateVideoBtn: string;
  generateImageBtn: string;
  animateBtn: string;
  generateLipSyncBtn: string;
  generatingBtn: string;
  downloadVideoBtn: string;
  downloadImageBtn: string;
  shareBtn: string;
  animateImageBtn: string;
  readyVideoTitle: string;
  readyImageTitle: string;
  readySubtitle: string;
  creationsTitle: string;
  creationsSubtitle: string;
  creationsEmptyTitle: string;
  creationsEmptySubtitle: string;
  createFirstBtn: string;
  searchPlaceholder: string;
  filterAll: string;
  filterImages: string;
  filterVideos: string;
  footerCredit: string;
}

const EN: UIStrings = {
  navTextToVideo: 'Text to Video (15s Auto)',
  navImageToVideo: 'Image to Video',
  navLipSync: 'AI Lip-Sync / Singing Photo',
  navFilmDirector: 'Film Director',
  navTextToImage: 'Text to Image',
  navLifetimeFree: 'Lifetime Free',
  navMyCreations: 'My Creations',
  newCanvas: 'New Canvas',
  languageLabel: 'Language',
  promptLabel: 'Prompt',
  promptPlaceholderVideo: 'e.g., A majestic lion walking in a glowing cyberpunk jungle at sunset...',
  promptPlaceholderImage: 'Describe your scene, lighting, framing, and mood...',
  promptPlaceholderAnimate: 'Describe how the subject, lighting, and camera should move...',
  magicEnhance: 'Magic Enhance Prompt',
  enhancing: 'Enhancing...',
  aspectRatio: 'Aspect Ratio',
  ratioWide: '16:9 YouTube',
  ratioVertical: '9:16 Reels/TikTok',
  ratioSquare: '1:1 Square',
  stylePreset: 'Style Preset',
  duration: 'Duration',
  renderQuality: 'Export Quality',
  fastMode: 'Fast 720p (3GB RAM Friendly)',
  fullHdMode: '1080p Full HD',
  ultraHd: '4K Ultra HD',
  cameraMotion: 'Camera Motion',
  voiceoverLabel: 'AI Voiceover (Speech)',
  voiceoverHint: 'Speaks prompt narration using browser voice synthesis',
  musicLabel: 'Background Music (Optional)',
  musicUpload: 'Upload Audio (MP3 / WAV)',
  musicRemove: 'Remove',
  generateVideoBtn: 'Generate Real AI Video',
  generateImageBtn: 'Generate Full HD Image',
  animateBtn: 'Animate Image with AI',
  generateLipSyncBtn: 'Generate Talking / Singing Video',
  generatingBtn: 'Generating...',
  downloadVideoBtn: 'Download MP4',
  downloadImageBtn: 'Download Full HD',
  shareBtn: 'Share',
  animateImageBtn: 'Animate Image',
  readyVideoTitle: 'Ready for Free Unlimited Video',
  readyImageTitle: 'Ready for Full HD Image Synthesis',
  readySubtitle: 'Enter any prompt and generate 100% free with zero API keys or credit limits.',
  creationsTitle: 'My Creations',
  creationsSubtitle: 'All generated images and videos are stored locally for instant download.',
  creationsEmptyTitle: 'Your creations gallery is empty',
  creationsEmptySubtitle: 'Generate a video or image and it will appear here automatically.',
  createFirstBtn: 'Create First Video',
  searchPlaceholder: 'Search prompts...',
  filterAll: 'All',
  filterImages: 'Images',
  filterVideos: 'Videos',
  footerCredit: 'Developed by Jatt Official',
};

const TRANSLATIONS: Record<LanguageCode, Partial<UIStrings>> = {
  en: EN,
  ur: {
    navTextToVideo: 'ٹیکسٹ سے ویڈیو (15s آٹو)',
    navImageToVideo: 'تصویر سے ویڈیو',
    navTextToImage: 'ٹیکسٹ سے تصویر',
    navMyCreations: 'میری تخلیقات',
    newCanvas: 'نیا کینوس',
    languageLabel: 'زبان',
    promptLabel: 'پرامپٹ',
    magicEnhance: 'پرامپٹ بہتر بنائیں',
    enhancing: 'بہتر ہو رہا ہے...',
    aspectRatio: 'اسپیکٹ ریشو',
    stylePreset: 'اسٹائل پری سیٹ',
    duration: 'دورانیہ',
    renderQuality: 'کوالٹی',
    cameraMotion: 'کیمرہ موشن',
    voiceoverLabel: 'اے آئی وائس اوور',
    musicLabel: 'بیک گراؤنڈ میوزک',
    musicUpload: 'آڈیو اپ لوڈ کریں',
    generateVideoBtn: 'مفت اے آئی ویڈیو بنائیں',
    generateImageBtn: 'فل ایچ ڈی تصویر بنائیں',
    animateBtn: 'تصویر کو ویڈیو میں بدلیں',
    downloadVideoBtn: 'ویڈیو ڈاؤن لوڈ کریں',
    downloadImageBtn: 'تصویر ڈاؤن لوڈ کریں',
    shareBtn: 'شیئر کریں',
    creationsTitle: 'میری تخلیقات',
    footerCredit: 'تیار کردہ جٹ آفیشل',
  },
  pa: {
    navTextToVideo: 'ਟੈਕਸਟ ਤੋਂ ਵੀਡੀਓ (15s ਆਟੋ)',
    navImageToVideo: 'ਤਸਵੀਰ ਤੋਂ ਵੀਡੀਓ',
    navTextToImage: 'ਟੈਕਸਟ ਤੋਂ ਤਸਵੀਰ',
    navMyCreations: 'ਮੇਰੀਆਂ ਰਚਨਾਵਾਂ',
    newCanvas: 'ਨਵਾਂ ਕੈਨਵਸ',
    languageLabel: 'ਭਾਸ਼ਾ',
    promptLabel: 'ਪ੍ਰੋਂਪਟ',
    magicEnhance: 'ਪ੍ਰੋਂਪਟ ਸੁਧਾਰੋ',
    aspectRatio: 'ਅਨੁਪਾਤ',
    stylePreset: 'ਸਟਾਈਲ',
    duration: 'ਸਮਾਂ',
    renderQuality: 'ਕੁਆਲਿਟੀ',
    cameraMotion: 'ਕੈਮਰਾ ਮੋਸ਼ਨ',
    voiceoverLabel: 'AI ਵੌਇਸਓਵਰ',
    musicLabel: 'ਬੈਕਗ੍ਰਾਊਂਡ ਸੰਗੀਤ',
    musicUpload: 'ਆਡੀਓ ਅੱਪਲੋਡ ਕਰੋ',
    generateVideoBtn: 'AI ਵੀਡੀਓ ਬਣਾਓ',
    generateImageBtn: 'HD ਤਸਵੀਰ ਬਣਾਓ',
    animateBtn: 'ਤਸਵੀਰ ਐਨੀਮੇਟ ਕਰੋ',
    downloadVideoBtn: 'ਵੀਡੀਓ ਡਾਊਨਲੋਡ ਕਰੋ',
    downloadImageBtn: 'ਤਸਵੀਰ ਡਾਊਨਲੋਡ ਕਰੋ',
    shareBtn: 'ਸਾਂਝਾ ਕਰੋ',
    creationsTitle: 'ਮੇਰੀਆਂ ਰਚਨਾਵਾਂ',
    footerCredit: 'Jatt Official ਵੱਲੋਂ ਤਿਆਰ',
  },
  hi: {
    navTextToVideo: 'टेक्स्ट से वीडियो (15s ऑटो)',
    navImageToVideo: 'फोटो से वीडियो',
    navTextToImage: 'टेक्स्ट से इमेज',
    navMyCreations: 'मेरी रचनाएँ',
    newCanvas: 'नया कैनवास',
    languageLabel: 'भाषा',
    promptLabel: 'प्रॉम्प्ट',
    magicEnhance: 'प्रॉम्प्ट बेहतर करें',
    aspectRatio: 'आस्पेक्ट रेशियो',
    stylePreset: 'स्टाइल प्रीसेट',
    duration: 'अवधि',
    renderQuality: 'क्वालिटी',
    cameraMotion: 'कैमरा मोशन',
    voiceoverLabel: 'AI वॉइसओवर',
    musicLabel: 'बैकग्राउंड म्यूज़िक',
    musicUpload: 'ऑडियो अपलोड करें',
    generateVideoBtn: 'AI वीडियो बनाएं',
    generateImageBtn: 'HD इमेज बनाएं',
    animateBtn: 'इमेज एनीमेट करें',
    downloadVideoBtn: 'वीडियो डाउनलोड करें',
    downloadImageBtn: 'इमेज डाउनलोड करें',
    shareBtn: 'शेयर करें',
    creationsTitle: 'मेरी रचनाएँ',
    footerCredit: 'Jatt Official द्वारा निर्मित',
  },
  ar: {
    navTextToVideo: 'نص إلى فيديو (15 ثانية)',
    navImageToVideo: 'صورة إلى فيديو',
    navTextToImage: 'نص إلى صورة',
    navMyCreations: 'إبداعاتي',
    newCanvas: 'مشروع جديد',
    languageLabel: 'اللغة',
    promptLabel: 'الوصف',
    magicEnhance: 'تحسين الوصف',
    aspectRatio: 'نسبة العرض',
    stylePreset: 'النمط',
    duration: 'المدة',
    renderQuality: 'الجودة',
    cameraMotion: 'حركة الكاميرا',
    voiceoverLabel: 'تعليق صوتي ذكي',
    musicLabel: 'موسيقى خلفية',
    musicUpload: 'رفع ملف صوتي',
    generateVideoBtn: 'إنشاء فيديو بالذكاء الاصطناعي',
    generateImageBtn: 'إنشاء صورة عالية الدقة',
    animateBtn: 'تحريك الصورة',
    downloadVideoBtn: 'تحميل الفيديو',
    downloadImageBtn: 'تحميل الصورة',
    shareBtn: 'مشاركة',
    creationsTitle: 'إبداعاتي',
    footerCredit: 'تطوير Jatt Official',
  },
  es: {
    navTextToVideo: 'Texto a Video (15s Auto)',
    navImageToVideo: 'Imagen a Video',
    navTextToImage: 'Texto a Imagen',
    navMyCreations: 'Mis Creaciones',
    newCanvas: 'Nuevo Lienzo',
    languageLabel: 'Idioma',
    magicEnhance: 'Mejorar Prompt',
    aspectRatio: 'Relación de Aspecto',
    stylePreset: 'Estilo Visual',
    duration: 'Duración',
    renderQuality: 'Calidad',
    cameraMotion: 'Movimiento de Cámara',
    voiceoverLabel: 'Voz en Off IA',
    musicLabel: 'Música de Fondo',
    musicUpload: 'Subir Audio',
    generateVideoBtn: 'Generar Video IA',
    generateImageBtn: 'Generar Imagen HD',
    animateBtn: 'Animar Imagen',
    downloadVideoBtn: 'Descargar Video',
    downloadImageBtn: 'Descargar HD',
    shareBtn: 'Compartir',
    creationsTitle: 'Mis Creaciones',
  },
  fr: {
    navTextToVideo: 'Texte en Vidéo (15s Auto)',
    navImageToVideo: 'Image en Vidéo',
    navTextToImage: 'Texte en Image',
    navMyCreations: 'Mes Créations',
    newCanvas: 'Nouveau Canevas',
    languageLabel: 'Langue',
    magicEnhance: 'Améliorer le Prompt',
    aspectRatio: 'Format',
    stylePreset: 'Style',
    duration: 'Durée',
    renderQuality: 'Qualité',
    cameraMotion: 'Mouvement Caméra',
    voiceoverLabel: 'Voix Off IA',
    musicLabel: 'Musique de Fond',
    musicUpload: 'Importer Audio',
    generateVideoBtn: 'Générer Vidéo IA',
    generateImageBtn: 'Générer Image HD',
    animateBtn: 'Animer Image',
    downloadVideoBtn: 'Télécharger Vidéo',
    downloadImageBtn: 'Télécharger HD',
    shareBtn: 'Partager',
    creationsTitle: 'Mes Créations',
  },
  de: {
    navTextToVideo: 'Text zu Video (15s Auto)',
    navImageToVideo: 'Bild zu Video',
    navTextToImage: 'Text zu Bild',
    navMyCreations: 'Meine Werke',
    newCanvas: 'Neue Leinwand',
    languageLabel: 'Sprache',
    magicEnhance: 'Prompt Verbessern',
    aspectRatio: 'Seitenverhältnis',
    stylePreset: 'Stilvorlage',
    duration: 'Dauer',
    renderQuality: 'Qualität',
    cameraMotion: 'Kamerafahrt',
    voiceoverLabel: 'KI-Sprachausgabe',
    musicLabel: 'Hintergrundmusik',
    musicUpload: 'Audio Hochladen',
    generateVideoBtn: 'KI-Video Erstellen',
    generateImageBtn: 'HD-Bild Erstellen',
    animateBtn: 'Bild Animieren',
    downloadVideoBtn: 'Video Herunterladen',
    downloadImageBtn: 'HD Herunterladen',
    shareBtn: 'Teilen',
    creationsTitle: 'Meine Werke',
  },
  tr: {
    navTextToVideo: 'Metinden Video (15s Oto)',
    navImageToVideo: 'Görselden Video',
    navTextToImage: 'Metinden Görsel',
    navMyCreations: 'Eserlerim',
    newCanvas: 'Yeni Tuval',
    languageLabel: 'Dil',
    magicEnhance: 'İstemi Geliştir',
    aspectRatio: 'En Boy Oranı',
    stylePreset: 'Stil',
    duration: 'Süre',
    renderQuality: 'Kalite',
    cameraMotion: 'Kamera Hareketi',
    voiceoverLabel: 'Yapay Zeka Seslendirme',
    musicLabel: 'Arka Plan Müziği',
    musicUpload: 'Ses Yükle',
    generateVideoBtn: 'Yapay Zeka Video Üret',
    generateImageBtn: 'HD Görsel Üret',
    animateBtn: 'Görseli Canlandır',
    downloadVideoBtn: 'Videoyu İndir',
    downloadImageBtn: 'HD İndir',
    shareBtn: 'Paylaş',
    creationsTitle: 'Eserlerim',
  },
  ru: {
    navTextToVideo: 'Текст в Видео (15с Авто)',
    navImageToVideo: 'Фото в Видео',
    navTextToImage: 'Текст в Картинку',
    navMyCreations: 'Мои Работы',
    newCanvas: 'Новый Холст',
    languageLabel: 'Язык',
    promptLabel: 'Промпт',
    magicEnhance: 'Улучшить Промпт',
    aspectRatio: 'Соотношение Сторон',
    stylePreset: 'Стиль',
    duration: 'Длительность',
    renderQuality: 'Качество',
    cameraMotion: 'Движение Камеры',
    voiceoverLabel: 'ИИ Озвучка',
    musicLabel: 'Фоновая Музыка',
    musicUpload: 'Загрузить Аудио',
    generateVideoBtn: 'Создать ИИ Видео',
    generateImageBtn: 'Создать HD Фото',
    animateBtn: 'Оживить Фото',
    downloadVideoBtn: 'Скачать Видео',
    downloadImageBtn: 'Скачать HD',
    shareBtn: 'Поделиться',
    creationsTitle: 'Мои Работы',
  },
  zh: {
    navTextToVideo: '文生视频 (15秒自动)',
    navImageToVideo: '图生视频',
    navTextToImage: '文生图片',
    navMyCreations: '我的作品',
    newCanvas: '新建画布',
    languageLabel: '语言',
    promptLabel: '提示词',
    magicEnhance: '智能优化提示词',
    aspectRatio: '画面比例',
    stylePreset: '风格预设',
    duration: '时长',
    renderQuality: '画质',
    cameraMotion: '镜头运动',
    voiceoverLabel: 'AI 语音旁白',
    musicLabel: '背景音乐',
    musicUpload: '上传音频',
    generateVideoBtn: '生成 AI 视频',
    generateImageBtn: '生成高清图片',
    animateBtn: '图片转视频',
    downloadVideoBtn: '下载视频',
    downloadImageBtn: '下载高清图',
    shareBtn: '分享',
    creationsTitle: '我的作品',
  },
  ja: {
    navTextToVideo: 'テキストから動画 (15秒自動)',
    navImageToVideo: '画像から動画',
    navTextToImage: 'テキストから画像',
    navMyCreations: 'マイ作品',
    newCanvas: '新規キャンバス',
    languageLabel: '言語',
    promptLabel: 'プロンプト',
    magicEnhance: 'プロンプト強化',
    aspectRatio: 'アスペクト比',
    stylePreset: 'スタイル',
    duration: '再生時間',
    renderQuality: '画質',
    cameraMotion: 'カメラモーション',
    voiceoverLabel: 'AI ナレーション',
    musicLabel: 'BGM (任意)',
    musicUpload: '音声アップロード',
    generateVideoBtn: 'AI動画を生成',
    generateImageBtn: 'HD画像を生成',
    animateBtn: '画像を動画化',
    downloadVideoBtn: '動画をダウンロード',
    downloadImageBtn: 'HDダウンロード',
    shareBtn: '共有',
    creationsTitle: 'マイ作品',
  },
  ko: {
    navTextToVideo: '텍스트 투 비디오 (15초 자동)',
    navImageToVideo: '이미지 투 비디오',
    navTextToImage: '텍스트 투 이미지',
    navMyCreations: '내 작품',
    newCanvas: '새 캔버스',
    languageLabel: '언어',
    promptLabel: '프롬프트',
    magicEnhance: '프롬프트 자동 향상',
    aspectRatio: '화면 비율',
    stylePreset: '스타일 프리셋',
    duration: '길이',
    renderQuality: '화질',
    cameraMotion: '카메라 움직임',
    voiceoverLabel: 'AI 음성 내레이션',
    musicLabel: '배경 음악 (선택)',
    musicUpload: '오디오 업로드',
    generateVideoBtn: 'AI 비디오 생성',
    generateImageBtn: 'HD 이미지 생성',
    animateBtn: '이미지 애니메이션',
    downloadVideoBtn: '비디오 다운로드',
    downloadImageBtn: 'HD 다운로드',
    shareBtn: '공유',
    creationsTitle: '내 작품',
  },
  sd: {
    navTextToVideo: 'ٽيڪسٽ کان وڊيو (15s آٽو)',
    navImageToVideo: 'تصوير کان وڊيو',
    navLipSync: 'AI لپ سنڪ / ڳائڻي تصوير',
    navTextToImage: 'ٽيڪسٽ کان تصوير',
    navMyCreations: 'منهنجون تخليقون',
    newCanvas: 'نئون ڪينواس',
    languageLabel: 'ٻولي',
    promptLabel: 'پرامپٽ',
    magicEnhance: 'پرامپٽ بهتر بڻايو',
    enhancing: 'بهتر ٿي رهيو آهي...',
    aspectRatio: 'اسپيڪٽ ريشو',
    stylePreset: 'اسٽائيل',
    duration: 'مدت',
    renderQuality: 'معيار',
    cameraMotion: 'ڪيمرا موشن',
    voiceoverLabel: 'AI وائس اوور',
    musicLabel: 'پس منظر موسيقي',
    musicUpload: 'آڊيو اپلوڊ ڪريو',
    generateVideoBtn: 'AI وڊيو ٺاهيو',
    generateImageBtn: 'HD تصوير ٺاهيو',
    animateBtn: 'تصوير کي وڊيو بڻايو',
    generateLipSyncBtn: 'ڳالهائيندڙ وڊيو ٺاهيو',
    downloadVideoBtn: 'وڊيو ڊائونلوڊ ڪريو',
    downloadImageBtn: 'تصوير ڊائونلوڊ ڪريو',
    shareBtn: 'شيئر ڪريو',
    creationsTitle: 'منهنجون تخليقون',
    footerCredit: 'تيار ڪندڙ Jatt Official',
  },
  ta: {
    navTextToVideo: 'உரையிலிருந்து வீடியோ (15s)',
    navImageToVideo: 'படத்திலிருந்து வீடியோ',
    navLipSync: 'AI லிப்-சிங்க் / பேசும் படம்',
    navTextToImage: 'உரையிலிருந்து படம்',
    navMyCreations: 'என் படைப்புகள்',
    newCanvas: 'புதிய கேன்வாஸ்',
    languageLabel: 'மொழி',
    promptLabel: 'ப்ராம்ப்ட்',
    magicEnhance: 'ப்ராம்ப்ட் மேம்படுத்து',
    enhancing: 'மேம்படுத்துகிறது...',
    aspectRatio: 'விகிதம்',
    stylePreset: 'நடை',
    duration: 'நேரம்',
    renderQuality: 'தரம்',
    cameraMotion: 'கேமரா இயக்கம்',
    voiceoverLabel: 'AI குரல் பதிவு',
    musicLabel: 'பின்னணி இசை',
    musicUpload: 'ஆடியோ பதிவேற்றம்',
    generateVideoBtn: 'AI வீடியோ உருவாக்கு',
    generateImageBtn: 'HD படம் உருவாக்கு',
    animateBtn: 'படத்தை அனிமேட் செய்',
    generateLipSyncBtn: 'பேசும் வீடியோ உருவாக்கு',
    downloadVideoBtn: 'வீடியோ பதிவிறக்கு',
    downloadImageBtn: 'HD படம் பதிவிறக்கு',
    shareBtn: 'பகிர்',
    creationsTitle: 'என் படைப்புகள்',
    footerCredit: 'உருவாக்கியது Jatt Official',
  },
  te: {
    navTextToVideo: 'టెక్స్ట్ నుండి వీడియో (15s)',
    navImageToVideo: 'చిత్రం నుండి వీడియో',
    navLipSync: 'AI లిప్-సింక్ / మాట్లాడే ఫోటో',
    navTextToImage: 'టెక్స్ట్ నుండి చిత్రం',
    navMyCreations: 'నా సృష్టులు',
    newCanvas: 'కొత్త కాన్వాస్',
    languageLabel: 'భాష',
    promptLabel: 'ప్రాంప్ట్',
    magicEnhance: 'ప్రాంప్ట్ మెరుగుపరచు',
    enhancing: 'మెరుగుపరుస్తోంది...',
    aspectRatio: 'నిష్పత్తి',
    stylePreset: 'శైలి',
    duration: 'సమయం',
    renderQuality: 'నాణ్యత',
    cameraMotion: 'కెమెరా కదలిక',
    voiceoverLabel: 'AI వాయిస్‌ఓవర్',
    musicLabel: 'నేపథ్య సంగీతం',
    musicUpload: 'ఆడియో అప్‌లోడ్ చేయండి',
    generateVideoBtn: 'AI వీడియో సృష్టించు',
    generateImageBtn: 'HD చిత్రం సృష్టించు',
    animateBtn: 'చిత్రాన్ని యానిమేట్ చేయి',
    generateLipSyncBtn: 'మాట్లాడే వీడియో సృష్టించు',
    downloadVideoBtn: 'వీడియో డౌన్‌లోడ్',
    downloadImageBtn: 'HD డౌన్‌లోడ్',
    shareBtn: 'షేర్ చేయండి',
    creationsTitle: 'నా సృష్టులు',
    footerCredit: 'రూపొందించినది Jatt Official',
  },
};

export function getUIStrings(code: LanguageCode): UIStrings {
  return {
    ...EN,
    ...(TRANSLATIONS[code] ?? {}),
  };
}

export function getLanguageMeta(code: LanguageCode): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
