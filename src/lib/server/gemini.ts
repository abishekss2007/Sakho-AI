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
