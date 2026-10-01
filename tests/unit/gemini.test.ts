// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The official SDK is replaced at the module boundary: no network, no key.
const sdk = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(options: { message: string; status: number }) {
      super(options.message);
      this.status = options.status;
    }
  }
  return { generateContent: vi.fn(), constructed: vi.fn(), ApiError };
});

vi.mock('@google/genai', () => ({
  ApiError: sdk.ApiError,
  GoogleGenAI: class {
    models = { generateContent: sdk.generateContent };
    constructor(options: unknown) {
      sdk.constructed(options);
    }
  },
}));

import { generateJson, geminiConfigured } from '@/lib/server/gemini';
import { ApiFailure } from '@/lib/server/http';

const request = () => ({
  system: 'rules',
  contents: [{ role: 'user' as const, text: 'hi' }],
  schema: { type: 'object' },
  maxOutputTokens: 50,
  signal: new AbortController().signal,
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiFailure) return error.code;
    throw error;
  }
  return 'no failure';
}

describe('gemini adapter', () => {
  beforeEach(() => {
    sdk.generateContent.mockReset();
    sdk.constructed.mockReset();
  });

  it('does not create a client or call the provider without a key', async () => {
    expect(geminiConfigured()).toBe(false);
    expect(await code(generateJson(request()))).toBe('provider_unavailable');
    expect(sdk.constructed).not.toHaveBeenCalled();
  });

  it('sends the configured model, system instruction and JSON schema', async () => {
    process.env.GEMINI_API_KEY = 'test-key-a';
    process.env.GEMINI_MODEL = 'gemini-test-model';
    sdk.generateContent.mockResolvedValue({ text: '{"reply":"hello"}' });
    expect(await generateJson(request())).toEqual({ reply: 'hello' });
    const sent = sdk.generateContent.mock.calls[0]?.[0];
    expect(sent.model).toBe('gemini-test-model');
    expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(sent.config.systemInstruction).toBe('rules');
    expect(sent.config.responseMimeType).toBe('application/json');
    expect(sent.config.responseJsonSchema).toEqual({ type: 'object' });
    expect(sent.config.httpOptions.retryOptions.attempts).toBe(2);
    expect(sent.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to the default model', async () => {
    process.env.GEMINI_API_KEY = 'test-key-b';
    sdk.generateContent.mockResolvedValue({ text: '{}' });
    await generateJson(request());
    expect(sdk.generateContent.mock.calls[0]?.[0].model).toBe('gemini-3.5-flash-lite');
  });

  it('maps provider errors to stable codes', async () => {
    process.env.GEMINI_API_KEY = 'test-key-c';
    const cases: [unknown, string][] = [
      [new sdk.ApiError({ message: 'quota', status: 429 }), 'provider_rate_limited'],
      [new sdk.ApiError({ message: 'deadline', status: 504 }), 'provider_timeout'],
      [new sdk.ApiError({ message: 'model not found', status: 404 }), 'provider_unavailable'],
      [new sdk.ApiError({ message: 'bad key', status: 403 }), 'provider_unavailable'],
      [new Error('socket hang up'), 'provider_unavailable'],
    ];
    for (const [error, expected] of cases) {
      sdk.generateContent.mockRejectedValueOnce(error);
      expect(await code(generateJson(request()))).toBe(expected);
    }
  });

  it('rejects empty and non-JSON replies', async () => {
    process.env.GEMINI_API_KEY = 'test-key-d';
    sdk.generateContent.mockResolvedValueOnce({ text: undefined });
    expect(await code(generateJson(request()))).toBe('provider_bad_response');
    sdk.generateContent.mockResolvedValueOnce({ text: '<html>oops</html>' });
    expect(await code(generateJson(request()))).toBe('provider_bad_response');
  });

  it('reports a timeout when the caller aborts', async () => {
    process.env.GEMINI_API_KEY = 'test-key-e';
    const controller = new AbortController();
    sdk.generateContent.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await code(generateJson({ ...request(), signal: controller.signal }))).toBe('provider_timeout');
  });
});
