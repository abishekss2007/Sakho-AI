import type { z } from 'zod';
import {
  chatResponseSchema,
  errorEnvelopeSchema,
  schemeCheckResponseSchema,
  understandResponseSchema,
  type ChatRequest,
  type ChatResponse,
  type ErrorCode,
  type SchemeCheckRequest,
  type SchemeCheckResponse,
  type UnderstandRequest,
  type UnderstandResponse,
} from '@/lib/api/contracts';

export type ClientErrorCode = ErrorCode | 'network' | 'aborted' | 'bad_response';

export class ApiClientError extends Error {
  constructor(public readonly code: ClientErrorCode) {
    super(code);
  }
}

async function post<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new ApiClientError((error as { name?: string } | null)?.name === 'AbortError' ? 'aborted' : 'network');
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiClientError('bad_response');
  }
  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(json);
    throw new ApiClientError(envelope.success ? envelope.data.error.code : 'bad_response');
  }
  // Responses are validated too: a malformed reply must not reach the screen.
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiClientError('bad_response');
  return parsed.data;
}

export const api = {
  chat: (body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> =>
    post('/api/chat', body, chatResponseSchema, signal),
  understand: (body: UnderstandRequest, signal?: AbortSignal): Promise<UnderstandResponse> =>
    post('/api/understand', body, understandResponseSchema, signal),
  schemeCheck: (body: SchemeCheckRequest, signal?: AbortSignal): Promise<SchemeCheckResponse> =>
    post('/api/scheme/check', body, schemeCheckResponseSchema, signal),
};

export type Api = typeof api;
