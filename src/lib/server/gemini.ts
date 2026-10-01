import { ApiError, GoogleGenAI } from '@google/genai';
import { geminiConfig } from './config';
import { ApiFailure } from './http';

/**
 * The only place that talks to Gemini. The client is created lazily on first
 * use, so importing this module (during build, tests or health checks) needs
 * no API key.
 */

export interface JsonGenerationRequest {
  system: string;
  contents: { role: 'user' | 'model'; text: string }[];
  /** JSON Schema the reply must follow. */
  schema: unknown;
  maxOutputTokens: number;
  /** Aborts when the browser disconnects. */
  signal: AbortSignal;
}

export type GenerateJson = (request: JsonGenerationRequest) => Promise<unknown>;

export const GEMINI_TIMEOUT_MS = 20_000;

let cached: { key: string; client: GoogleGenAI } | undefined;

function getClient(apiKey: string): GoogleGenAI {
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new GoogleGenAI({ apiKey }) };
  return cached.client;
}

export function geminiConfigured(): boolean {
  return Boolean(geminiConfig().apiKey);
}

export const generateJson: GenerateJson = async (request) => {
  const { apiKey, model } = geminiConfig();
  if (!apiKey) throw new ApiFailure('provider_unavailable', 'The AI assistant is not configured.');

  const timeout = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeout]);

  let text: string | undefined;
  try {
    const response = await getClient(apiKey).models.generateContent({
      model,
      contents: request.contents.map((c) => ({ role: c.role, parts: [{ text: c.text }] })),
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
        maxOutputTokens: request.maxOutputTokens,
        temperature: 0.3,
        abortSignal: signal,
        // Generation is read-only, so one retry on a transient failure is safe.
        httpOptions: { timeout: GEMINI_TIMEOUT_MS, retryOptions: { attempts: 2 } },
      },
    });
    text = response.text;
  } catch (error) {
    if (signal.aborted) throw new ApiFailure('provider_timeout', 'The AI assistant took too long.');
    if (error instanceof ApiError) {
      if (error.status === 429) {
        throw new ApiFailure('provider_rate_limited', 'The AI assistant is busy. Try again soon.');
      }
      if (error.status === 408 || error.status === 504) {
        throw new ApiFailure('provider_timeout', 'The AI assistant took too long.');
      }
    }
    // Includes unknown or retired model names, bad keys and provider outages.
    throw new ApiFailure('provider_unavailable', 'The AI assistant is not available right now.');
  }

  if (!text) throw new ApiFailure('provider_bad_response', 'The AI assistant returned an empty reply.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiFailure('provider_bad_response', 'The AI assistant returned an unreadable reply.');
  }
};

// ---- Speech ---------------------------------------------------------------

/**
 * Speech models in the order they are tried. Each has its own request quota,
 * and free-tier quotas are small, so a busy model falls through to the next.
 */
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'] as const;
export const DEFAULT_GEMINI_TTS_MODEL = GEMINI_TTS_MODELS[0];
/** "Kore" is one of Gemini's prebuilt female voices; the same voice is used for every language. */
export const DEFAULT_GEMINI_TTS_VOICE = 'Kore';
export const GEMINI_TTS_TIMEOUT_MS = 20_000;

export interface SpeechResult {
  bytes: Uint8Array;
  contentType: string;
}

export type GenerateSpeech = (prompt: string, signal: AbortSignal) => Promise<SpeechResult>;

/** Wrap raw 16-bit mono PCM in a WAV header so browsers can play it. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

function speechModels(): string[] {
  const preferred = process.env.GEMINI_TTS_MODEL;
  return [...new Set([...(preferred ? [preferred] : []), ...GEMINI_TTS_MODELS])];
}

/** Speech from a Gemini text-to-speech model, using the same API key as chat. */
export const generateSpeech: GenerateSpeech = async (prompt, requestSignal) => {
  const { apiKey } = geminiConfig();
  if (!apiKey) throw new ApiFailure('provider_unavailable', 'Speech is not configured.');
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS)]);

  let failure = new ApiFailure('provider_unavailable', 'Speech is not available right now.');
  for (const model of speechModels()) {
    let data: string | undefined;
    let mimeType = '';
    try {
      const response = await getClient(apiKey).models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || DEFAULT_GEMINI_TTS_VOICE } },
          },
          abortSignal: signal,
          httpOptions: { timeout: GEMINI_TTS_TIMEOUT_MS, retryOptions: { attempts: 1 } },
        },
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      data = part?.inlineData?.data;
      mimeType = part?.inlineData?.mimeType ?? '';
    } catch (error) {
      if (signal.aborted) throw new ApiFailure('provider_timeout', 'Speech took too long.');
      // Over quota, or a model this key cannot use: the next model may still work.
      failure =
        error instanceof ApiError && error.status === 429
          ? new ApiFailure('provider_rate_limited', 'Speech is busy. Try again in a minute.', 60)
          : new ApiFailure('provider_unavailable', 'Speech is not available right now.');
      continue;
    }

    if (!data) {
      failure = new ApiFailure('provider_bad_response', 'Speech returned no audio.');
      continue;
    }
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    if (mimeType.startsWith('audio/wav') || mimeType.startsWith('audio/x-wav')) {
      return { bytes, contentType: 'audio/wav' };
    }
    if (/audio\/(l16|pcm)/i.test(mimeType)) {
      const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1]) || 24_000;
      return { bytes: pcmToWav(bytes, rate), contentType: 'audio/wav' };
    }
    if (mimeType.startsWith('audio/')) return { bytes, contentType: mimeType.split(';')[0] ?? mimeType };
    failure = new ApiFailure('provider_bad_response', 'Speech returned an unknown format.');
  }
  throw failure;
};

// ---- Streaming speech -------------------------------------------------------

export const GEMINI_TTS_STREAM_TIMEOUT_MS = 45_000;
export const SPEECH_SAMPLE_RATE = 24_000;

/** Raw 16-bit mono PCM chunks at `SPEECH_SAMPLE_RATE`, in the order they should be played. */
export type StreamSpeech = (text: string, signal: AbortSignal) => AsyncGenerator<Uint8Array, void, void>;

/**
 * Speech as it is generated. Models are tried in order until one starts
 * producing audio; once audio has started, a failure ends the stream.
 */
export const streamSpeech: StreamSpeech = async function* (text, requestSignal) {
  const { apiKey } = geminiConfig();
  if (!apiKey) throw new ApiFailure('provider_unavailable', 'Speech is not configured.');
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(GEMINI_TTS_STREAM_TIMEOUT_MS)]);

  let failure = new ApiFailure('provider_unavailable', 'Speech is not available right now.');
  for (const model of speechModels()) {
    let started = false;
    try {
      const stream = await getClient(apiKey).models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || DEFAULT_GEMINI_TTS_VOICE } },
          },
          abortSignal: signal,
          httpOptions: { timeout: GEMINI_TTS_STREAM_TIMEOUT_MS, retryOptions: { attempts: 1 } },
        },
      });
      for await (const chunk of stream) {
        const part = chunk.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        const data = part?.inlineData?.data;
        if (!data) continue;
        const mimeType = part?.inlineData?.mimeType ?? '';
        let bytes = new Uint8Array(Buffer.from(data, 'base64'));
        if (/audio\/(x-)?wav/i.test(mimeType)) bytes = bytes.subarray(44);
        else if (!/audio\/(l16|pcm)/i.test(mimeType)) {
          throw new ApiFailure('provider_bad_response', 'Speech returned an unknown format.');
        }
        if (bytes.byteLength === 0) continue;
        started = true;
        yield bytes;
      }
      if (started) return;
      failure = new ApiFailure('provider_bad_response', 'Speech returned no audio.');
    } catch (error) {
      if (signal.aborted) throw new ApiFailure('provider_timeout', 'Speech took too long.');
      const mapped =
        error instanceof ApiFailure
          ? error
          : error instanceof ApiError && error.status === 429
            ? new ApiFailure('provider_rate_limited', 'Speech is busy. Try again in a minute.', 60)
            : new ApiFailure('provider_unavailable', 'Speech is not available right now.');
      // Audio already reached the listener: another model would start the sentence again.
      if (started) throw mapped;
      failure = mapped;
    }
  }
  throw failure;
};
