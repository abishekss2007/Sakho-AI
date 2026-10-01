// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as chat } from '@/app/api/chat/route';
import { GET as health } from '@/app/api/health/route';
import { POST as schemeCheck } from '@/app/api/scheme/check/route';
import { POST as tts } from '@/app/api/tts/route';
import { POST as understand } from '@/app/api/understand/route';
import {
  chatResponseSchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  LIMITS,
  schemeCheckResponseSchema,
  understandResponseSchema,
} from '@/lib/api/contracts';
import { applicableQuestions, evaluate, getQuestions } from '@/lib/scheme/engine';
import { resetMemoryStore } from '@/lib/server/rateLimit';
import type { Answers } from '@/lib/scheme/types';

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response) {
  const parsed = errorEnvelopeSchema.parse(await response.json());
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-request-id')).toBe(parsed.requestId);
  return parsed.error.code;
}

let logged: string[];
beforeEach(() => {
  resetMemoryStore();
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

describe('POST /api/scheme/check', () => {
  it('returns the next question for empty answers, never a determination', async () => {
    const response = await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy', answers: {} }));
    expect(response.status).toBe(200);
    const body = schemeCheckResponseSchema.parse(await response.json());
    expect(body.result).toMatchObject({ status: 'questions_remaining', nextQuestionId: 'pregnant_or_recent_birth' });
  });

  it('gives exactly the same result as the engine bundled in the browser, for every answer set', async () => {
    const combos: Answers[] = [{}];
    for (const q of getQuestions()) {
      for (const base of [...combos]) for (const option of q.options) combos.push({ ...base, [q.id]: option });
    }
    expect(combos.length).toBeGreaterThan(200);
    for (const answers of combos) {
      const response = await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy', answers }));
      const body = schemeCheckResponseSchema.parse(await response.json());
      expect(body.result).toEqual(JSON.parse(JSON.stringify(evaluate(answers))));
      if (body.result.status === 'review') {
        expect(applicableQuestions(answers).every((q) => answers[q.id] !== undefined)).toBe(true);
        expect(body.result.rules.rulesStatus).toBe('draft');
      }
    }
  });

  it('asks for clarification on contradictory answers', async () => {
    const answers = { pregnant_or_recent_birth: 'no', has_category_proof: 'yes' };
    const body = await (await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy', answers }))).json();
    expect(body.result).toEqual({ status: 'needs_clarification', conflicts: ['has_category_proof'] });
  });

  it('rejects malformed requests with the error envelope', async () => {
    expect(await errorOf(await schemeCheck(post('/api/scheme/check', '{not json')))).toBe('invalid_json');
    expect(await errorOf(await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy' })))).toBe('invalid_request');
    expect(
      await errorOf(await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy', answers: { child_order: 'fifth' } }))),
    ).toBe('invalid_request');
    expect(
      await errorOf(await schemeCheck(post('/api/scheme/check', { schemeId: 'pmmvy', answers: {}, extra: 1 }))),
    ).toBe('invalid_request');
    const text = new Request('http://localhost/api/scheme/check', { method: 'POST', body: 'hello' });
    expect(await errorOf(await schemeCheck(text))).toBe('unsupported_media_type');
    const huge = post('/api/scheme/check', { schemeId: 'pmmvy', answers: {}, pad: 'x'.repeat(LIMITS.bodyBytes) });
    expect(await errorOf(await schemeCheck(huge))).toBe('payload_too_large');
  });

  it('does not echo submitted values in validation errors', async () => {
    const response = await schemeCheck(
      post('/api/scheme/check', { schemeId: 'pmmvy', answers: { child_order: 'my-secret-value' } }),
    );
    const text = await response.text();
    expect(text).toContain('answers.child_order');
    expect(text).not.toContain('my-secret-value');
  });

  it('rejects requests from another origin', async () => {
    const request = post('/api/scheme/check', { schemeId: 'pmmvy', answers: {} }, { origin: 'https://evil.example' });
    const response = await schemeCheck(request);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('forbidden_origin');
    const same = post('/api/scheme/check', { schemeId: 'pmmvy', answers: {} }, { origin: 'http://localhost' });
    expect((await schemeCheck(same)).status).toBe(200);
  });
});

describe('POST /api/chat', () => {
  const body = { messages: [{ role: 'user', text: 'My husband beats me. PRIVATE-MARKER' }], locale: 'hi', inputMode: 'text' };

  it('returns 503 provider_unavailable without a key, and logs no message text', async () => {
    const response = await chat(post('/api/chat', body));
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('provider_unavailable');
    expect(logged.join('\n')).not.toContain('PRIVATE-MARKER');
    expect(logged.join('\n')).toContain('"route":"/api/chat"');
  });

  it('answers through the mock provider with a valid contract', async () => {
    process.env.SAKHO_MOCK_PROVIDERS = 'true';
    const response = await chat(post('/api/chat', body));
    expect(response.status).toBe(200);
    const parsed = chatResponseSchema.parse(await response.json());
    expect(parsed.provider).toBe('mock');
    expect(parsed.reply.language).toBe('hi');
    expect(parsed.safety.urgent).toBe(false);
    expect(logged.join('\n')).not.toContain('PRIVATE-MARKER');
  });

  it('validates before spending quota', async () => {
    expect(await errorOf(await chat(post('/api/chat', { ...body, messages: [] })))).toBe('invalid_request');
    expect(await errorOf(await chat(post('/api/chat', { ...body, locale: 'xx' })))).toBe('invalid_request');
    expect(await errorOf(await chat(post('/api/chat', { ...body, messages: [{ role: 'system', text: 'x' }] })))).toBe(
      'invalid_request',
    );
  });

  it('rate limits per client with Retry-After', async () => {
    process.env.SAKHO_MOCK_PROVIDERS = 'true';
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    const headers = { 'x-forwarded-for': '198.51.100.7' };
    expect((await chat(post('/api/chat', body, headers))).status).toBe(200);
    expect((await chat(post('/api/chat', body, headers))).status).toBe(200);
    const limited = await chat(post('/api/chat', body, headers));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await errorOf(limited)).toBe('rate_limited');
    expect(logged.join('\n')).not.toContain('198.51.100.7');
  });
});

describe('POST /api/understand', () => {
  const body = { schemeId: 'pmmvy', questionId: 'child_order', utterance: 'second one', locale: 'en', sessionId: 'session-0001' };

  it('interprets a reply and echoes the question and session for stale-response checks', async () => {
    const response = await understand(post('/api/understand', body));
    const parsed = understandResponseSchema.parse(await response.json());
    expect(parsed).toMatchObject({
      questionId: 'child_order',
      sessionId: 'session-0001',
      interpretation: { kind: 'answer', value: 'second' },
      via: 'keywords',
    });
  });

  it('returns emergency suggestions and unclear replies', async () => {
    const urgent = await (await understand(post('/api/understand', { ...body, utterance: 'emergency help me' }))).json();
    expect(urgent.interpretation).toEqual({ kind: 'emergency_suggestion', serviceId: 'erss_112' });
    const unclear = await (await understand(post('/api/understand', { ...body, utterance: 'umm' }))).json();
    expect(unclear.interpretation).toEqual({ kind: 'unclear' });
  });

  it('rejects unknown questions', async () => {
    expect(await errorOf(await understand(post('/api/understand', { ...body, questionId: 'salary' })))).toBe('invalid_request');
  });
});

describe('POST /api/tts', () => {
  const body = { text: 'नमस्ते', locale: 'hi', speed: 'normal' };

  it('returns a JSON error when cloud speech is off', async () => {
    const response = await tts(post('/api/tts', body));
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('provider_unavailable');
  });

  it('returns uncached audio from the mock provider', async () => {
    process.env.SAKHO_MOCK_PROVIDERS = 'true';
    const response = await tts(post('/api/tts', body));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await response.arrayBuffer()).byteLength).toBe(Number(response.headers.get('content-length')));
  });

  it('validates input', async () => {
    expect(await errorOf(await tts(post('/api/tts', { ...body, speed: 'warp' })))).toBe('invalid_request');
    expect(await errorOf(await tts(post('/api/tts', { ...body, text: 'x'.repeat(LIMITS.ttsChars + 1) })))).toBe('invalid_request');
  });
});

describe('GET /api/health', () => {
  it('reports liveness without secrets or provider calls', async () => {
    process.env.GEMINI_API_KEY = 'super-secret-key';
    const response = health();
    const text = await response.clone().text();
    expect(healthResponseSchema.parse(JSON.parse(text))).toEqual({
      ok: true,
      service: 'sakho-ai',
      providers: 'live',
      sosMode: 'demo',
      rateLimit: 'per-instance',
    });
    expect(text).not.toContain('super-secret-key');
  });

  it('only the exact value "live" turns on live emergency mode', async () => {
    for (const value of ['LIVE', 'true', 'production', ' live', '']) {
      process.env.SOS_MODE = value;
      expect((await health().json()).sosMode).toBe('demo');
    }
    process.env.SOS_MODE = 'live';
    expect((await health().json()).sosMode).toBe('live');
  });
});
