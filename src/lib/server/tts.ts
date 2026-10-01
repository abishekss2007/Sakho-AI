import { SPEAKING_RATE, type TtsRequest } from '@/lib/api/contracts';
import { LANGUAGES } from '@/lib/languages';
import { mockProviders, ttsEnabled } from './config';
import { geminiConfigured, generateSpeech, type GenerateSpeech } from './gemini';
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
  geminiAvailable?: boolean;
}

/**
 * Gemini speech models take delivery instructions in plain words, followed by
 * the text. The text is user-visible content, so it goes after a fixed prefix.
 */
const GEMINI_STYLE: Record<TtsRequest['speed'], string> = {
  slow: 'Read this aloud slowly, warmly and very clearly',
  normal: 'Read this aloud warmly and clearly',
  fast: 'Read this aloud clearly at a brisk pace',
};

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
  if (!ttsEnabled()) {
    if (!(deps.geminiAvailable ?? geminiConfigured())) {
      throw new ApiFailure('provider_unavailable', 'Speech is not configured.');
    }
    const language = LANGUAGES[request.locale].englishName;
    const audio = await (deps.speak ?? generateSpeech)(
      `${GEMINI_STYLE[request.speed]}, in ${language}: ${request.text}`,
      signal,
    );
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
        audioConfig: { audioEncoding: 'MP3', speakingRate: SPEAKING_RATE[request.speed] },
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
