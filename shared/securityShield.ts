export interface SafeValidationResult {
  safe: boolean;
  sanitized: string;
  reason?: string;
}

export interface MediaFileValidationResult {
  valid: boolean;
  reason?: string;
}

export interface DomainIntegrityResult {
  allowed: boolean;
  reason?: string;
  hostname: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-:=+/]{8,}/gi,
  /\bsk-or-v1-[A-Za-z0-9]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{14,}\b/g,
  /\bhf_[A-Za-z0-9]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{16,}\b/g,
  /\bgsk_[A-Za-z0-9]{12,}\b/g,
  /\br8_[A-Za-z0-9]{10,}\b/g,
  /\btgp_v1_[A-Za-z0-9_-]{10,}\b/g,
  /\bdigen_[A-Za-z0-9_-]{8,}\b/gi,
  /\bagnes_[A-Za-z0-9_-]{8,}\b/gi,
  /\bpk_[A-Za-z0-9_-]{12,}\b/g,
  /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[a-f0-9]{16,}/gi,
];

/**
 * Masks any API key for safe display (e.g. "sk-****1234").
 */
export function maskApiKey(rawKey: string | undefined | null): string {
  const key = (rawKey ?? '').trim();
  if (!key) return '';
  if (key.length <= 6) {
    return `${key.slice(0, 1)}****`;
  }
  const prefixLen = key.startsWith('AIza') ? 4 : key.includes('_') ? Math.min(4, key.indexOf('_') + 1) : 3;
  const prefix = key.slice(0, prefixLen);
  const suffix = key.slice(-4);
  return `${prefix}****${suffix}`;
}

/**
 * Redacts API tokens or keys from error strings and logs.
 */
export function redactSecrets(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
      ? input
      : String(input ?? '');
  let cleaned = raw;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      if (/^Bearer\s+/i.test(match)) {
        return 'Bearer [REDACTED]';
      }
      return maskApiKey(match) || '[REDACTED]';
    });
  }
  return cleaned;
}

/**
 * Sanitizes text input against HTML tags, script payloads, and control chars
 * while preserving Unicode scripts (Urdu, Punjabi, Sindhi, Tamil, Telugu, Hindi, etc.).
 */
export function sanitizeUserText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\bon(?:click|load|error|mouseover|focus|submit|input)\s*=/gi, '')
    .replace(/(?:javascript|vbscript|data:text\/html)\s*:/gi, '');
}

const XSS_PAYLOAD_RE =
  /(<\s*(script|iframe|object|embed|svg|style)\b|\bon(?:error|load|click|mouseover|focus)\s*=|\b(?:javascript|vbscript):|data:text\/html|document\.cookie|window\.location|\beval\s*\(|\bnew\s+Function\s*\()/i;

const URL_IN_PROMPT_RE =
  /((?:https?:\/\/|ftp:\/\/|www\.)[^\s]+|\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|rb\.gy|cutt\.ly|ow\.ly|shorturl\.at)\/[^\s]*|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/[^\s]*)?)/i;

const SCAM_PHISHING_RE =
  /(\b(?:send|share|enter|verify|tell|give|type|reveal)\s+(?:me\s+)?(?:your|the)?\s*(?:bank|account|atm|card|login|wallet|sms|email)?\s*(?:otp|one\s+time\s+password|pin|cvv|password|passcode|verification\s+code|seed\s+phrase|recovery\s+phrase)\b|\b(?:urgent|immediate)\s+(?:wire\s+transfer|bank\s+verification|kyc\s+update)\b|\bclick\s+(?:this|here)\s+to\s+claim\s+(?:prize|lottery|reward)\b)/i;

/**
 * Validates prompts and dialogue scripts against XSS, phishing URLs, and scam social-engineering patterns.
 */
export function validateSafePromptAndScript(
  rawInput: string,
  label = 'Input'
): SafeValidationResult {
  const trimmed = (rawInput ?? '').trim();
  if (!trimmed) {
    return { safe: true, sanitized: '' };
  }

  if (trimmed.length > 4000) {
    return {
      safe: false,
      sanitized: sanitizeUserText(trimmed.slice(0, 4000)),
      reason: `${label} is too long (maximum 4,000 characters allowed).`,
    };
  }

  if (XSS_PAYLOAD_RE.test(trimmed)) {
    return {
      safe: false,
      sanitized: sanitizeUserText(trimmed),
      reason: 'Blocked unsafe script or HTML code inside prompt for your security.',
    };
  }

  if (URL_IN_PROMPT_RE.test(trimmed)) {
    return {
      safe: false,
      sanitized: sanitizeUserText(trimmed),
      reason:
        'External links and shortened URLs are blocked in prompts/dialogues to protect against phishing and scam redirects.',
    };
  }

  if (SCAM_PHISHING_RE.test(trimmed)) {
    return {
      safe: false,
      sanitized: sanitizeUserText(trimmed),
      reason:
        'Blocked suspicious request asking for OTPs, banking PINs, passwords, or wallet recovery phrases.',
    };
  }

  return {
    safe: true,
    sanitized: sanitizeUserText(trimmed),
  };
}

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
]);

/**
 * Strict MIME + extension + size validation for uploaded user media files.
 */
export function validateMediaUploadFile(
  file: { name: string; type: string; size: number },
  kind: 'image' | 'audio'
): MediaFileValidationResult {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase().split(';')[0].trim();

  if (kind === 'image') {
    if (mime === 'image/svg+xml' || lowerName.endsWith('.svg') || lowerName.endsWith('.html')) {
      return {
        valid: false,
        reason: 'SVG and HTML files are blocked for security. Please upload PNG, JPG, or WebP.',
      };
    }
    const validExt = /\.(png|jpe?g|webp)$/i.test(lowerName);
    if ((mime && !ALLOWED_IMAGE_MIMES.has(mime)) || (!mime && !validExt)) {
      return {
        valid: false,
        reason: 'Unsupported image format. Please upload PNG, JPG, or WebP.',
      };
    }
    if (file.size > 25 * 1024 * 1024) {
      return {
        valid: false,
        reason: 'Image file exceeds 25 MB safety limit.',
      };
    }
    return { valid: true };
  }

  if (
    mime === 'text/html' ||
    mime === 'application/javascript' ||
    /\.(html?|js|svg|exe|sh|bat)$/i.test(lowerName)
  ) {
    return {
      valid: false,
      reason: 'Blocked unsafe file type. Please upload MP3, WAV, M4A, or OGG audio.',
    };
  }
  const validAudioExt = /\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(lowerName);
  if ((mime && !ALLOWED_AUDIO_MIMES.has(mime)) || (!mime && !validAudioExt)) {
    return {
      valid: false,
      reason: 'Unsupported audio format. Please upload MP3, WAV, M4A, or OGG.',
    };
  }
  if (file.size > 40 * 1024 * 1024) {
    return {
      valid: false,
      reason: 'Audio file exceeds 40 MB safety limit.',
    };
  }
  return { valid: true };
}

/**
 * Validates Data URLs received on server routes so SVG/HTML data URLs cannot be processed.
 */
export function isSafeMediaDataUrl(
  dataUrl: string | undefined | null,
  kind: 'image' | 'audio'
): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  if (kind === 'image') {
    return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(dataUrl);
  }
  return /^data:audio\/(mpeg|mp3|wav|x-wav|wave|ogg|webm|mp4|m4a|x-m4a|aac)(?:;[^,]*)?;base64,[A-Za-z0-9+/=\s]+$/i.test(
    dataUrl
  );
}

/**
 * Validates external Custom Backend endpoint URLs against SSRF (private IP & metadata ranges).
 */
export function validateExternalEndpointUrl(rawUrl: string): {
  valid: boolean;
  parsed?: URL;
  reason?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'Invalid URL format. Include https:// or http://' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Only HTTP and HTTPS backend URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isBlockedInternal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd');

  if (isBlockedInternal) {
    return {
      valid: false,
      reason: 'Private network and local metadata addresses are blocked for security.',
    };
  }

  return { valid: true, parsed };
}

const TRUSTED_HOST_SUFFIXES = [
  '.run.app',
  '.vercel.app',
  '.web.app',
  '.firebaseapp.com',
  '.aistudio.google.com',
  '.googleusercontent.com',
];

const TRUSTED_PARENT_HOST_SUFFIXES = [
  'aistudio.google.com',
  '.google.com',
  '.googleusercontent.com',
  '.run.app',
  '.vercel.app',
  'localhost',
  '127.0.0.1',
];

function matchesHostSuffix(hostname: string, patterns: string[]): boolean {
  const clean = hostname.toLowerCase();
  return patterns.some((p) => {
    const norm = p.trim().toLowerCase();
    if (!norm) return false;
    if (norm.startsWith('.')) {
      return clean.endsWith(norm) || clean === norm.slice(1);
    }
    return clean === norm || clean.endsWith(`.${norm}`);
  });
}

/**
 * Verifies domain authenticity & anti-clickjacking frame origin integrity while keeping
 * Google AI Studio preview iframes and localhost/Vercel deployments fully operational.
 */
export function verifyDomainAndFrameIntegrity(extraAllowedDomainsRaw = ''): DomainIntegrityResult {
  if (typeof window === 'undefined') {
    return { allowed: true, hostname: 'server' };
  }

  const hostname = (window.location.hostname || '').toLowerCase();
  const envAllowed = extraAllowedDomainsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const isKnownHost =
    isLocal ||
    matchesHostSuffix(hostname, TRUSTED_HOST_SUFFIXES) ||
    (envAllowed.length > 0 && matchesHostSuffix(hostname, envAllowed));

  if (!isKnownHost) {
    return {
      allowed: false,
      hostname,
      reason: `Unauthorized clone domain detected (${hostname || 'unknown'}). This studio only runs on verified Jatt CineGen AI deployments.`,
    };
  }

  // Anti-clickjacking frame check (preserving AI Studio preview iframes & same-origin framing)
  try {
    if (window.self !== window.top) {
      const ancestorOrigins = window.location.ancestorOrigins;
      if (ancestorOrigins && ancestorOrigins.length > 0) {
        const topOrigin = ancestorOrigins[ancestorOrigins.length - 1];
        try {
          const parentHost = new URL(topOrigin).hostname.toLowerCase();
          const trustedParent =
            parentHost === hostname ||
            matchesHostSuffix(parentHost, TRUSTED_PARENT_HOST_SUFFIXES) ||
            (envAllowed.length > 0 && matchesHostSuffix(parentHost, envAllowed));
          if (!trustedParent) {
            return {
              allowed: false,
              hostname,
              reason: `Blocked unauthorized iframe clickjacking embed from ${parentHost}.`,
            };
          }
        } catch {
          return {
            allowed: false,
            hostname,
            reason: 'Blocked unrecognized external frame origin.',
          };
        }
      } else if (document.referrer) {
        try {
          const refHost = new URL(document.referrer).hostname.toLowerCase();
          const trustedRef =
            refHost === hostname ||
            matchesHostSuffix(refHost, TRUSTED_PARENT_HOST_SUFFIXES) ||
            (envAllowed.length > 0 && matchesHostSuffix(refHost, envAllowed));
          if (!trustedRef) {
            return {
              allowed: false,
              hostname,
              reason: `Blocked unauthorized third-party embed (${refHost}).`,
            };
          }
        } catch {
          // Ignore opaque sandbox referrer in dev
        }
      }
    }
  } catch {
    // Cross-origin frame check fallback: rely on CSP frame-ancestors + known hostname check
  }

  return { allowed: true, hostname };
}
