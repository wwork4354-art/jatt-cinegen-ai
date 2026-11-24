export const FULL_BODY_FRAMING_INSTRUCTIONS =
  'full body shot from head to toe, wide angle, front-facing view, clear detailed face, anatomically accurate both arms and hands clearly visible';

export const CHARACTER_LIMB_HEAD_NEGATIVE_RULES =
  'cropped head, cut off head, out of frame head, decapitated, cropped feet, cut off legs, missing limbs, missing arms, missing hands, extra limbs, extra arms, extra fingers, deformed hands, fused fingers, mutated anatomy, disfigured face, blurry face';

export const CLOSEUP_ANATOMY_NEGATIVE_RULES =
  'cropped head, cut off head, out of frame head, missing limbs, missing hands, extra fingers, deformed hands, mutated anatomy, disfigured face, blurry face';

export const BASE_VIDEO_NEGATIVE_PROMPT =
  'worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text, low quality';

const PERSON_OR_CHARACTER_REGEX =
  /\b(person|people|man|men|woman|women|boy|boys|girl|girls|child|children|kid|kids|baby|toddler|teen|teenager|elder|elderly|senior|human|humanoid|character|characters|hero|heroine|warrior|king|queen|prince|princess|knight|soldier|samurai|ninja|wizard|witch|singer|dancer|actor|actress|model|athlete|runner|lady|gentleman|guy|dude|couple|family|friend|friends|crowd|farmer|chef|doctor|pilot|astronaut|avatar|musician|performer|speaker|presenter|portrait|someone|somebody|bride|groom|student|teacher|driver|worker|rider|player|guard|officer|merchant|villager|traveler|wanderer|nomad|monk|jatt|sardar|poet|artist|host|anchor|pakistani|indian|arab|american|european|asian|african|korean|japanese|chinese|british|he|she|his|her|him|they|their)\b/i;

const CLOSEUP_REQUEST_REGEX =
  /\b(close[\s-]?up|closeup|extreme close[\s-]?up|ecu|macro shot|headshot|head[\s-]?shot|bust shot|shoulder[\s-]?up|waist[\s-]?up|medium close|tight shot|tight framing|face only|selfie)\b/i;

export function detectPersonOrCharacter(prompt: string): boolean {
  if (!prompt || !prompt.trim()) return false;
  return PERSON_OR_CHARACTER_REGEX.test(prompt);
}

export function isCloseUpRequested(prompt: string): boolean {
  if (!prompt || !prompt.trim()) return false;
  return CLOSEUP_REQUEST_REGEX.test(prompt);
}

export function enhanceTextToVideoPromptFraming(prompt: string): string {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return trimmed;
  if (!detectPersonOrCharacter(trimmed) || isCloseUpRequested(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const clausesToAppend: string[] = [];

  const hasFullBody =
    lower.includes('full body shot from head to toe') ||
    (lower.includes('full body') && lower.includes('head to toe'));
  if (!hasFullBody) {
    clausesToAppend.push('full body shot from head to toe');
  }

  if (!/\bwide[\s-]?angle\b/i.test(trimmed)) {
    clausesToAppend.push('wide angle');
  }

  if (!/\bfront[\s-]?facing\b/i.test(trimmed)) {
    clausesToAppend.push('front-facing view');
  }

  if (!lower.includes('clear detailed face') && !lower.includes('detailed face')) {
    clausesToAppend.push('clear detailed face');
  }

  if (
    !lower.includes('anatomically accurate both arms and hands clearly visible') &&
    !(lower.includes('both arms') && lower.includes('hands clearly visible'))
  ) {
    clausesToAppend.push('anatomically accurate both arms and hands clearly visible');
  }

  if (clausesToAppend.length === 0) {
    return trimmed;
  }

  const separator = /[,;.!?]\s*$/.test(trimmed) ? ' ' : ', ';
  return `${trimmed}${separator}${clausesToAppend.join(', ')}`;
}

export function buildVideoNegativePrompt(prompt: string, extraNegative?: string): string {
  const parts: string[] = [];

  if (detectPersonOrCharacter(prompt)) {
    parts.push(
      isCloseUpRequested(prompt)
        ? CLOSEUP_ANATOMY_NEGATIVE_RULES
        : CHARACTER_LIMB_HEAD_NEGATIVE_RULES
    );
  }

  parts.push(BASE_VIDEO_NEGATIVE_PROMPT);

  if (extraNegative && extraNegative.trim()) {
    parts.push(extraNegative.trim());
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const segment of parts.join(',').split(',')) {
    const clean = segment.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(clean);
  }

  return deduped.join(', ');
}
