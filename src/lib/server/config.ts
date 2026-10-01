import { resolveSosMode, type SosMode } from '@/lib/emergency';

/**
 * Server-only runtime configuration. Everything is read from `process.env`
 * when called, never at module load, so builds and health checks work with no
 * credentials present.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function mockProviders(): boolean {
  return process.env.SAKHO_MOCK_PROVIDERS === 'true';
}

export function geminiConfig(): { apiKey: string | undefined; model: string } {
  return {
    apiKey: process.env.GEMINI_API_KEY || undefined,
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  };
}

export function ttsEnabled(): boolean {
  return process.env.TTS_ENABLED === 'true';
}

/**
 * Which voice is tried first. `device` (default) is instant and free; set
 * `cloud` when the speech service has enough quota and one consistent voice
 * across devices matters more.
 */
export function speechPreference(): 'device' | 'cloud' {
  return process.env.SPEECH_PREFERENCE === 'cloud' ? 'cloud' : 'device';
}

export function sosMode(): SosMode {
  return resolveSosMode(process.env.SOS_MODE);
}

export function limitsConfig() {
  return {
    perMinute: positiveInt(process.env.RATE_LIMIT_PER_MINUTE, 12),
    dailyCap: positiveInt(process.env.DAILY_PAID_REQUEST_CAP, 2000),
    redisUrl: process.env.RATE_LIMIT_REDIS_REST_URL || undefined,
    redisToken: process.env.RATE_LIMIT_REDIS_REST_TOKEN || undefined,
    trustedProxyHops: Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS) || 0),
  };
}
