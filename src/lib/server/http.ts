import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ERROR_STATUS, LIMITS, type ErrorCode, type ErrorEnvelope } from '@/lib/api/contracts';
import { logEvent } from './log';

/** Random identifier for correlating logs. Contains no personal information. */
export function newRequestId(): string {
  return randomUUID();
}

export class ApiFailure extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonOk<T extends object>(requestId: string, body: T, init?: { headers?: HeadersInit }) {
  return Response.json(
    { ok: true, requestId, ...body },
    { status: 200, headers: { ...NO_STORE, 'X-Request-Id': requestId, ...init?.headers } },
  );
}

export function jsonError(requestId: string, failure: ApiFailure): Response {
  const body: ErrorEnvelope = {
    ok: false,
    requestId,
    error: { code: failure.code, message: failure.message },
  };
  const headers: Record<string, string> = { ...NO_STORE, 'X-Request-Id': requestId };
  if (failure.retryAfterSeconds) headers['Retry-After'] = String(failure.retryAfterSeconds);
  return Response.json(body, { status: ERROR_STATUS[failure.code], headers });
}

/**
 * Reject browser requests coming from another site. This is not
 * authentication; it stops other websites from spending this deployment's
 * provider quota through their visitors' browsers.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiFailure('forbidden_origin', 'Cross-origin requests are not allowed.');
  }
  if (!host || originHost !== host) {
    throw new ApiFailure('forbidden_origin', 'Cross-origin requests are not allowed.');
  }
}

/** Read and validate a bounded JSON body against a schema. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiFailure('unsupported_media_type', 'Content-Type must be application/json.');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > LIMITS.bodyBytes) {
    throw new ApiFailure('payload_too_large', 'Request body is too large.');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.bodyBytes) {
    throw new ApiFailure('payload_too_large', 'Request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiFailure('invalid_json', 'Request body is not valid JSON.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Field paths only: issue messages can echo submitted values.
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(body)'))];
    throw new ApiFailure('invalid_request', `Invalid request fields: ${fields.join(', ')}`);
  }
  return result.data;
}

/**
 * Shared wrapper: assigns a request id, converts failures to the error
 * envelope, and logs only operational metadata.
 */
export async function handle(
  route: string,
  request: Request,
  work: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = newRequestId();
  const started = Date.now();
  let response: Response;
  let code: string | undefined;
  try {
    assertSameOrigin(request);
    response = await work(requestId);
  } catch (error) {
    const failure =
      error instanceof ApiFailure ? error : new ApiFailure('internal_error', 'Something went wrong.');
    code = failure.code;
    response = jsonError(requestId, failure);
  }
  logEvent({ requestId, route, status: response.status, code, durationMs: Date.now() - started });
  return response;
}
