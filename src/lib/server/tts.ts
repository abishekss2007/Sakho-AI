import type { TtsRequest } from '@/lib/api/contracts';
import { LANGUAGES } from '@/lib/languages';
import { mockProviders, ttsEnabled } from './config';
import {
  geminiConfigured,
  generateSpeech,
  pcmToWav,
  SPEECH_SAMPLE_RATE,
  streamSpeech,
  type GenerateSpeech,
  type StreamSpeech,
} from './gemini';
import { ApiFailure } from './http';

/**
 * Speech synthesis. Two providers, chosen by configuration:
 *
 * - Google Cloud Text-to-Speech when `TTS_ENABLED=true`. Called over REST with
 *   an Application Default Credentials token (the attached service account on
 *   Cloud Run), so no key file is handled by the app.
 * - Otherwise a Gemini speech model, when `GEMINI_API_KEY` is set. It needs no
 *   cloud project and speaks whatever language the text is written in.
 */

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
export const TTS_TIMEOUT_MS = 10_000;

export interface TtsDeps {
  getToken?: () => Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
  speak?: GenerateSpeech;
  speakStream?: StreamSpeech;
  geminiAvailable?: boolean;
}

/**
 * Audio for fixed interface text, kept in memory so the same question is not
 * synthesised again for every user. Only requests marked `shared` are stored.
 */
const SHARED_AUDIO_LIMIT = 300;
const sharedAudio = new Map<string, TtsAudio>();

function sharedKey(request: TtsRequest): string {
  return `${request.locale}|${request.text}`;
}

/** For tests. */
export function clearSharedAudio(): void {
  sharedAudio.clear();
}

export interface TtsAudio {
  bytes: Uint8Array;
  contentType: string;
  provider: 'google' | 'gemini' | 'mock';
}

let tokenProvider: (() => Promise<string | null | undefined>) | undefined;

async function defaultGetToken(): Promise<string | null | undefined> {
  if (!tokenProvider) {
    // Imported lazily so builds and unit tests never load or probe credentials.
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    tokenProvider = () => auth.getAccessToken();
  }
  return tokenProvider();
}

/** A 0.1 second silent WAV, used only when mock providers are enabled. */
export function silentWav(): Uint8Array {
  const sampleRate = 8000;
  const samples = sampleRate / 10;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buffer);
}

export async function synthesize(request: TtsRequest, signal: AbortSignal, deps: TtsDeps = {}): Promise<TtsAudio> {
  if (mockProviders()) return { bytes: silentWav(), contentType: 'audio/wav', provider: 'mock' };
  if (!request.shared) return synthesizeFresh(request, signal, deps);

  const key = sharedKey(request);
  const stored = sharedAudio.get(key);
  if (stored) return stored;
  const audio = await synthesizeFresh(request, signal, deps);
  rememberShared(request, audio);
  return audio;
}

export type SpeechResponse =
  | { kind: 'file'; audio: TtsAudio }
  | { kind: 'pcm'; sampleRate: number; chunks: AsyncGenerator<Uint8Array, void, void> };

function rememberShared(request: TtsRequest, audio: TtsAudio): void {
  if (sharedAudio.size >= SHARED_AUDIO_LIMIT) {
    const oldest = sharedAudio.keys().next().value;
    if (oldest !== undefined) sharedAudio.delete(oldest);
  }
  sharedAudio.set(sharedKey(request), audio);
}

/**
 * Speech for a request. When the caller asked for streaming and the Gemini
 * provider is in use, audio is relayed as it is generated; otherwise a
 * complete file is returned. Provider failures before the first sound are
 * thrown here, so the route can still answer with a normal error.
 */
export async function openSpeech(request: TtsRequest, signal: AbortSignal, deps: TtsDeps = {}): Promise<SpeechResponse> {
  const streamable = request.stream && !mockProviders() && !ttsEnabled();
  if (!streamable) return { kind: 'file', audio: await synthesize(request, signal, deps) };

  const stored = request.shared ? sharedAudio.get(sharedKey(request)) : undefined;
  if (stored) return { kind: 'file', audio: stored };
  if (!(deps.geminiAvailable ?? geminiConfigured())) {
    throw new ApiFailure('provider_unavailable', 'Speech is not configured.');
  }

  const source = (deps.speakStream ?? streamSpeech)(request.text, signal);
  const first = await source.next();
  if (first.done) throw new ApiFailure('provider_bad_response', 'Speech returned no audio.');

  async function* relay(): AsyncGenerator<Uint8Array, void, void> {
    const collected: Uint8Array[] = [first.value as Uint8Array];
    yield first.value as Uint8Array;
    for await (const chunk of source) {
      collected.push(chunk);
      yield chunk;
    }
    // Only a completed clip of fixed interface text is kept for reuse.
    if (request.shared) {
      const pcm = Buffer.concat(collected.map((c) => Buffer.from(c)));
      rememberShared(request, { bytes: pcmToWav(new Uint8Array(pcm), SPEECH_SAMPLE_RATE), contentType: 'audio/wav', provider: 'gemini' });
    }
  }
  return { kind: 'pcm', sampleRate: SPEECH_SAMPLE_RATE, chunks: relay() };
}

async function synthesizeFresh(request: TtsRequest, signal: AbortSignal, deps: TtsDeps): Promise<TtsAudio> {
  if (!ttsEnabled()) {
    if (!(deps.geminiAvailable ?? geminiConfigured())) {
      throw new ApiFailure('provider_unavailable', 'Speech is not configured.');
    }
    // Only the text itself is sent. An instruction such as "read this slowly" in front
    // of it gets spoken aloud by the voice, in English, before the real text.
    const audio = await (deps.speak ?? generateSpeech)(request.text, signal);
    return { ...audio, provider: 'gemini' };
  }

  let token: string | null | undefined;
  try {
    token = await (deps.getToken ?? defaultGetToken)();
  } catch {
    token = undefined;
  }
  if (!token) throw new ApiFailure('provider_unavailable', 'Cloud speech credentials are not available.');

  const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: request.text },
        // Only the language is requested; the provider chooses a voice. No voice names are assumed.
        voice: { languageCode: LANGUAGES[request.locale].bcp47 },
        // Always synthesised at normal speed; the player applies the user's speed.
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
      }),
      signal: combined,
    });
  } catch {
    if (combined.aborted) throw new ApiFailure('provider_timeout', 'Cloud speech took too long.');
    throw new ApiFailure('provider_unavailable', 'Cloud speech is not available right now.');
  }

  if (response.status === 429) throw new ApiFailure('provider_rate_limited', 'Cloud speech is busy.');
  if (!response.ok) {
    // Includes 400 for a language the provider has no voice for.
    throw new ApiFailure('provider_unavailable', 'Cloud speech could not produce audio for this request.');
  }

  let audioContent: unknown;
  try {
    audioContent = ((await response.json()) as { audioContent?: unknown }).audioContent;
  } catch {
    audioContent = undefined;
  }
  if (typeof audioContent !== 'string' || audioContent.length === 0) {
    throw new ApiFailure('provider_bad_response', 'Cloud speech returned no audio.');
  }
  return { bytes: new Uint8Array(Buffer.from(audioContent, 'base64')), contentType: 'audio/mpeg', provider: 'google' };
}
