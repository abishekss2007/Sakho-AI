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

import { generateJson, generateSpeech, geminiConfigured, pcmToWav } from '@/lib/server/gemini';
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

  describe('speech', () => {
    const audio = (mimeType: string, bytes: number[]) => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } }] } }],
    });
    const signal = () => new AbortController().signal;

    it('needs a key', async () => {
      expect(await code(generateSpeech('hello', signal()))).toBe('provider_unavailable');
      expect(sdk.generateContent).not.toHaveBeenCalled();
    });

    it('requests audio from the speech model and returns WAV as is', async () => {
      process.env.GEMINI_API_KEY = 'test-key-s1';
      sdk.generateContent.mockResolvedValue(audio('audio/wav', [82, 73, 70, 70]));
      const result = await generateSpeech('Read this: hello', signal());
      expect(result.contentType).toBe('audio/wav');
      expect([...result.bytes]).toEqual([82, 73, 70, 70]);
      const sent = sdk.generateContent.mock.calls[0]?.[0];
      expect(sent.model).toBe('gemini-3.8-flash-lite-tts');
      expect(sent.config.responseModalities).toEqual(['AUDIO']);
      expect(sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
      expect(sent.contents[0].parts[0].text).toBe('Read this: hello');
    });

    it('honours model and voice overrides and wraps raw PCM in a WAV header', async () => {
      process.env.GEMINI_API_KEY = 'test-key-s2';
      process.env.GEMINI_TTS_MODEL = 'custom-tts';
      process.env.GEMINI_TTS_VOICE = 'Leda';
      sdk.generateContent.mockResolvedValue(audio('audio/L16;codec=pcm;rate=16000', [1, 2, 3, 4]));
      const result = await generateSpeech('x', signal());
      expect(result.contentType).toBe('audio/wav');
      expect(result.bytes.byteLength).toBe(48);
      expect(Buffer.from(result.bytes.slice(0, 4)).toString()).toBe('RIFF');
      expect(Buffer.from(result.bytes).readUInt32LE(24)).toBe(16000);
      const sent = sdk.generateContent.mock.calls[0]?.[0];
      expect(sent.model).toBe('custom-tts');
      expect(sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Leda');
      expect(pcmToWav(new Uint8Array(2), 24000).byteLength).toBe(46);
    });

    it('maps failures and unusable replies', async () => {
      process.env.GEMINI_API_KEY = 'test-key-s3';
      sdk.generateContent.mockRejectedValueOnce(new sdk.ApiError({ message: 'quota', status: 429 }));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_rate_limited');
      sdk.generateContent.mockRejectedValueOnce(new Error('down'));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_unavailable');
      sdk.generateContent.mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] });
      expect(await code(generateSpeech('x', signal()))).toBe('provider_bad_response');
      sdk.generateContent.mockResolvedValueOnce(audio('text/plain', [1]));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_bad_response');
      sdk.generateContent.mockResolvedValueOnce(audio('audio/mpeg', [1]));
      expect((await generateSpeech('x', signal())).contentType).toBe('audio/mpeg');
      const controller = new AbortController();
      sdk.generateContent.mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      });
      expect(await code(generateSpeech('x', controller.signal))).toBe('provider_timeout');
    });
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
