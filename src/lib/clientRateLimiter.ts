import { useCallback, useEffect, useState } from 'react';

const RATE_STORAGE_KEY = 'jatt_cinegen_rate_guard_v1';
const MIN_COOLDOWN_MS = 3000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const SPAM_PENALTY_MS = 20_000;

interface StoredRateState {
  timestamps: number[];
  rapidClicks: number[];
  lastActionAt: number;
  blockedUntil: number;
}

function readRateState(): StoredRateState {
  try {
    const raw = sessionStorage.getItem(RATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredRateState>;
      return {
        timestamps: Array.isArray(parsed.timestamps) ? parsed.timestamps : [],
        rapidClicks: Array.isArray(parsed.rapidClicks) ? parsed.rapidClicks : [],
        lastActionAt: Number(parsed.lastActionAt) || 0,
        blockedUntil: Number(parsed.blockedUntil) || 0,
      };
    }
  } catch {
    // Ignore storage error
  }
  return { timestamps: [], rapidClicks: [], lastActionAt: 0, blockedUntil: 0 };
}

function writeRateState(state: StoredRateState): void {
  try {
    sessionStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage error
  }
}

export interface RateCheckResult {
  allowed: boolean;
  waitSeconds: number;
  reason?: string;
}

/**
 * Checks whether a generation action can proceed under cooldown & anti-spam rules.
 * Tracks rapid-click spam attempts so bots/scammers cannot flood provider quotas.
 */
export function checkAndConsumeRateLimit(actionLabel = 'generation'): RateCheckResult {
  const now = Date.now();
  const state = readRateState();

  // Prune old timestamps outside sliding 60s window
  state.timestamps = state.timestamps.filter((t) => now - t < WINDOW_MS);
  state.rapidClicks = state.rapidClicks.filter((t) => now - t < 5000);

  if (state.blockedUntil > now) {
    const waitSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
    return {
      allowed: false,
      waitSeconds,
      reason: `Anti-spam protection active. Please wait ${waitSeconds}s before starting another ${actionLabel}.`,
    };
  }

  // Detect rapid-fire automated clicking (>= 4 clicks within 3 seconds while throttled)
  if (state.lastActionAt > 0 && now - state.lastActionAt < MIN_COOLDOWN_MS) {
    state.rapidClicks.push(now);
    if (state.rapidClicks.length >= 4) {
      state.blockedUntil = now + SPAM_PENALTY_MS;
      writeRateState(state);
      const waitSeconds = Math.ceil(SPAM_PENALTY_MS / 1000);
      return {
        allowed: false,
        waitSeconds,
        reason: `Unusual burst activity detected. Automated spam guard paused requests for ${waitSeconds}s.`,
      };
    }
    writeRateState(state);
    const waitSeconds = Math.max(1, Math.ceil((state.lastActionAt + MIN_COOLDOWN_MS - now) / 1000));
    return {
      allowed: false,
      waitSeconds,
      reason: `Cooldown active. Please wait ${waitSeconds}s between requests.`,
    };
  }

  if (state.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = state.timestamps[0];
    const until = oldest + WINDOW_MS;
    state.blockedUntil = until;
    writeRateState(state);
    const waitSeconds = Math.max(1, Math.ceil((until - now) / 1000));
    return {
      allowed: false,
      waitSeconds,
      reason: `Rate limit reached (${MAX_REQUESTS_PER_WINDOW} requests/min) to protect API credits. Wait ${waitSeconds}s.`,
    };
  }

  // Consume slot
  state.timestamps.push(now);
  state.lastActionAt = now;
  state.rapidClicks = [];
  writeRateState(state);
  return { allowed: true, waitSeconds: 0 };
}

export function getRemainingCooldownSeconds(): number {
  const now = Date.now();
  const state = readRateState();
  const target = Math.max(state.blockedUntil, state.lastActionAt + MIN_COOLDOWN_MS);
  if (target <= now) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/**
 * React hook exposing live 1-second cooldown countdown & rate check trigger.
 */
export function useGenerationRateLimit() {
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(() =>
    getRemainingCooldownSeconds()
  );

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      const rem = getRemainingCooldownSeconds();
      setCooldownSeconds(rem);
      if (rem <= 0) {
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const tryAcquire = useCallback((actionLabel = 'generation'): RateCheckResult => {
    const result = checkAndConsumeRateLimit(actionLabel);
    setCooldownSeconds(getRemainingCooldownSeconds());
    return result;
  }, []);

  return {
    cooldownSeconds,
    tryAcquire,
  };
}
