import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'TTS_ENABLED',
  'SOS_MODE',
  'SAKHO_MOCK_PROVIDERS',
  'RATE_LIMIT_PER_MINUTE',
  'DAILY_PAID_REQUEST_CAP',
  'RATE_LIMIT_REDIS_REST_URL',
  'RATE_LIMIT_REDIS_REST_TOKEN',
  'TRUSTED_PROXY_HOPS',
];

// Every test starts with no provider configuration, exactly like CI.
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (typeof window !== 'undefined') window.localStorage.clear();
});
