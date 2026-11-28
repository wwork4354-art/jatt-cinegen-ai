export interface CharacterIdentityInput {
  enabled: boolean;
  characterName: string;
  fixedSeed: number;
  traitsPrompt: string;
}

/**
 * Generates a deterministic numeric seed from a string so characters stay locked
 * to the same facial geometry across shots when no manual seed is chosen.
 */
export function deriveSeedFromText(text: string): number {
  let hash = 2166136261;
  const normalized = text.trim().toLowerCase() || 'jatt-cinegen-character';
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 100000 + (Math.abs(hash) % 8999999);
}

/**
 * Injects strict facial, wardrobe, lighting, and seed continuity markers into
 * every image or video scene prompt when Character Face Lock is enabled.
 */
export function applyCharacterConsistencyLock(
  scenePrompt: string,
  lock?: CharacterIdentityInput | null
): { resolvedPrompt: string; seed?: number } {
  const cleanPrompt = scenePrompt.trim();
  if (!lock || !lock.enabled) {
    return { resolvedPrompt: cleanPrompt };
  }

  const safeSeed =
    Number.isFinite(lock.fixedSeed) && lock.fixedSeed > 0
      ? Math.floor(lock.fixedSeed)
      : deriveSeedFromText(lock.characterName || lock.traitsPrompt || cleanPrompt);

  const identityParts: string[] = [];
  if (lock.characterName.trim()) {
    identityParts.push(`same recurring character ${lock.characterName.trim()}`);
  } else {
    identityParts.push('same recurring lead character across all scenes');
  }

  if (lock.traitsPrompt.trim()) {
    identityParts.push(lock.traitsPrompt.trim());
  }

  identityParts.push(
    'strict facial identity consistency, identical face structure, matching eyes, hairstyle, wardrobe and cinematic lighting continuity'
  );

  const resolvedPrompt = `${cleanPrompt}, featuring ${identityParts.join(', ')}, consistency seed ${safeSeed}`;
  return { resolvedPrompt, seed: safeSeed };
}
