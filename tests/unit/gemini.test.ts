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
  return { generateContent: vi.fn(), generateContentStream: vi.fn(), constructed: vi.fn(), ApiError };
});

vi.mock('@google/genai', () => ({
  ApiError: sdk.ApiError,
  GoogleGenAI: class {
    models = { generateContent: sdk.generateContent, generateContentStream: sdk.generateContentStream };
    constructor(options: unknown) {
      sdk.constructed(options);
    }
  },
}));

import { generateJson, generateSpeech, geminiConfigured, pcmToWav, streamSpeech } from '@/lib/server/gemini';
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
    sdk.generateContentStream.mockReset();
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
      expect(sdk.generateContent).toHaveBeenCalledTimes(1);
      expect(sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Leda');
      expect(pcmToWav(new Uint8Array(2), 24000).byteLength).toBe(46);
    });

    it('falls through to the next speech model when one is over quota', async () => {
      process.env.GEMINI_API_KEY = 'test-key-s4';
      sdk.generateContent
        .mockRejectedValueOnce(new sdk.ApiError({ message: 'quota', status: 429 }))
        .mockResolvedValueOnce(audio('audio/wav', [9]));
      const result = await generateSpeech('x', signal());
      expect([...result.bytes]).toEqual([9]);
      expect(sdk.generateContent.mock.calls.map((c) => c[0].model)).toEqual([
        'gemini-3.8-flash-lite-tts',
        'gemini-3.8-flash-tts',
      ]);
    });

    it('reports the last failure when every speech model fails', async () => {
      process.env.GEMINI_API_KEY = 'test-key-s3';
      sdk.generateContent.mockRejectedValue(new sdk.ApiError({ message: 'quota', status: 429 }));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_rate_limited');
      expect(sdk.generateContent).toHaveBeenCalledTimes(3);
      sdk.generateContent.mockReset();
      sdk.generateContent.mockRejectedValue(new Error('down'));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_unavailable');
      sdk.generateContent.mockReset();
      sdk.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] });
      expect(await code(generateSpeech('x', signal()))).toBe('provider_bad_response');
      sdk.generateContent.mockReset();
      sdk.generateContent.mockResolvedValue(audio('text/plain', [1]));
      expect(await code(generateSpeech('x', signal()))).toBe('provider_bad_response');
      sdk.generateContent.mockReset();
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

  describe('streamed speech', () => {
    const piece = (mimeType: string, bytes: number[]) => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } }] } }],
    });
    const pcm = 'audio/L16;codec=pcm;rate=24000';
    async function* from(items: unknown[]) {
      for (const item of items) {
        if (item instanceof Error) throw item;
        yield item;
      }
    }
    const collect = async (text = 'x', signal = new AbortController().signal) => {
      const out: number[][] = [];
      for await (const chunk of streamSpeech(text, signal)) out.push([...chunk]);
      return out;
    };

    it('needs a key', async () => {
      expect(await code(collect())).toBe('provider_unavailable');
    });

    it('yields audio chunks in order and sends only the text', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st1';
      sdk.generateContentStream.mockResolvedValue(from([piece(pcm, [1, 2]), { candidates: [] }, piece(pcm, []), piece(pcm, [3, 4])]));
      expect(await collect('नमस्ते')).toEqual([[1, 2], [3, 4]]);
      const sent = sdk.generateContentStream.mock.calls[0]?.[0];
      expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'नमस्ते' }] }]);
      expect(sent.config.responseModalities).toEqual(['AUDIO']);
      expect(sent.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    });

    it('strips the header when a chunk arrives as WAV', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st2';
      sdk.generateContentStream.mockResolvedValue(from([piece('audio/wav', [...new Array(44).fill(0), 7, 8])]));
      expect(await collect()).toEqual([[7, 8]]);
    });

    it('moves to the next model when one is over quota before any audio', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st3';
      sdk.generateContentStream
        .mockRejectedValueOnce(new sdk.ApiError({ message: 'quota', status: 429 }))
        .mockResolvedValueOnce(from([piece(pcm, [9, 9])]));
      expect(await collect()).toEqual([[9, 9]]);
      expect(sdk.generateContentStream.mock.calls.map((c) => c[0].model)).toEqual([
        'gemini-3.8-flash-lite-tts',
        'gemini-3.8-flash-tts',
      ]);
    });

    it('does not restart on another model once audio has been sent', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st4';
      sdk.generateContentStream.mockResolvedValue(from([piece(pcm, [1, 2]), new Error('connection lost')]));
      const seen: number[][] = [];
      const run = (async () => {
        for await (const chunk of streamSpeech('x', new AbortController().signal)) seen.push([...chunk]);
      })();
      expect(await code(run)).toBe('provider_unavailable');
      expect(seen).toEqual([[1, 2]]);
      expect(sdk.generateContentStream).toHaveBeenCalledTimes(1);
    });

    it('reports the last failure when no model produces audio', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st5';
      sdk.generateContentStream.mockRejectedValue(new sdk.ApiError({ message: 'quota', status: 429 }));
      expect(await code(collect())).toBe('provider_rate_limited');
      expect(sdk.generateContentStream).toHaveBeenCalledTimes(3);
      sdk.generateContentStream.mockReset();
      sdk.generateContentStream.mockImplementation(async () => from([{ candidates: [] }]));
      expect(await code(collect())).toBe('provider_bad_response');
      sdk.generateContentStream.mockReset();
      sdk.generateContentStream.mockImplementation(async () => from([piece('video/mp4', [1])]));
      expect(await code(collect())).toBe('provider_bad_response');
    });

    it('reports a timeout when the caller aborts', async () => {
      process.env.GEMINI_API_KEY = 'test-key-st6';
      const controller = new AbortController();
      sdk.generateContentStream.mockImplementation(async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      });
      expect(await code(collect('x', controller.signal))).toBe('provider_timeout');
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
