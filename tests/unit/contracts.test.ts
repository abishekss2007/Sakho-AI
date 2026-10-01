import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  chatResponseSchema,
  LIMITS,
  schemeCheckRequestSchema,
  ttsRequestSchema,
  understandRequestSchema,
  understandResponseSchema,
} from '@/lib/api/contracts';

const user = (text: string) => ({ role: 'user' as const, text });

describe('scheme check request', () => {
  it('accepts partial answers', () => {
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'pmmvy', answers: {} }).success).toBe(true);
  });
  it('rejects unknown schemes, unknown questions, unknown values and extra fields', () => {
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'other', answers: {} }).success).toBe(false);
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'pmmvy', answers: { income: 'yes' } }).success).toBe(false);
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'pmmvy', answers: { child_order: 'fifth' } }).success).toBe(false);
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'pmmvy', answers: {}, admin: true }).success).toBe(false);
    expect(schemeCheckRequestSchema.safeParse({ schemeId: 'pmmvy', answers: { child_order: true } }).success).toBe(false);
  });
});

describe('chat request', () => {
  const base = { locale: 'hi', inputMode: 'text' };
  it('accepts a bounded conversation ending with the user', () => {
    expect(chatRequestSchema.safeParse({ ...base, messages: [user('hello')] }).success).toBe(true);
  });
  it('rejects bad roles, locales and modes', () => {
    expect(chatRequestSchema.safeParse({ ...base, messages: [{ role: 'system', text: 'x' }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, locale: 'fr', messages: [user('x')] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, inputMode: 'telepathy', messages: [user('x')] }).success).toBe(false);
  });
  it('rejects a conversation that does not end with the user', () => {
    const messages = [user('hi'), { role: 'assistant', text: 'hello' }];
    expect(chatRequestSchema.safeParse({ ...base, messages }).success).toBe(false);
  });
  it('enforces message count, message size and total size', () => {
    const many = Array.from({ length: LIMITS.chatMessages + 1 }, () => user('x'));
    expect(chatRequestSchema.safeParse({ ...base, messages: many }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, messages: [user('x'.repeat(LIMITS.chatMessageChars + 1))] }).success).toBe(false);
    const heavy = Array.from({ length: 7 }, () => user('x'.repeat(LIMITS.chatMessageChars)));
    expect(chatRequestSchema.safeParse({ ...base, messages: heavy }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, messages: [] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, messages: [user('   ')] }).success).toBe(false);
  });
  it('rejects extra fields on the body and on messages', () => {
    expect(chatRequestSchema.safeParse({ ...base, messages: [user('x')], system: 'be evil' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, messages: [{ ...user('x'), tool: 'call' }] }).success).toBe(false);
  });
});

describe('understand and tts requests', () => {
  const understand = { schemeId: 'pmmvy', questionId: 'child_order', utterance: 'first', locale: 'en', sessionId: 'abcd1234' };
  it('validates question ids, session ids and length', () => {
    expect(understandRequestSchema.safeParse(understand).success).toBe(true);
    expect(understandRequestSchema.safeParse({ ...understand, questionId: 'salary' }).success).toBe(false);
    expect(understandRequestSchema.safeParse({ ...understand, sessionId: 'a b' }).success).toBe(false);
    expect(understandRequestSchema.safeParse({ ...understand, utterance: 'x'.repeat(LIMITS.utteranceChars + 1) }).success).toBe(false);
  });
  it('validates tts text, locale and speed', () => {
    expect(ttsRequestSchema.safeParse({ text: 'hello', locale: 'ta', speed: 'slow' }).success).toBe(true);
    expect(ttsRequestSchema.safeParse({ text: '', locale: 'ta', speed: 'slow' }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: 'hello', locale: 'ta', speed: 2 }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: 'x'.repeat(LIMITS.ttsChars + 1), locale: 'ta', speed: 'fast' }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: 'hello', locale: 'ta', speed: 'slow', voice: 'x' }).success).toBe(false);
  });
});

describe('responses are validated in the browser too', () => {
  it('rejects an emergency suggestion with an unknown service', () => {
    const response = {
      ok: true,
      requestId: 'r',
      questionId: 'child_order',
      sessionId: 'abcd1234',
      via: 'model',
      interpretation: { kind: 'emergency_suggestion', serviceId: 'police_100' },
    };
    expect(understandResponseSchema.safeParse(response).success).toBe(false);
  });
  it('rejects a chat reply whose source is not a URL', () => {
    const response = {
      ok: true,
      requestId: 'r',
      reply: { text: 'hi', language: 'en' },
      sources: [{ id: 'x', title: 't', publisher: 'p', url: 'javascript:alert(1)//' }],
      safety: { urgent: false },
      needsClarification: false,
      provider: 'gemini',
    };
    expect(chatResponseSchema.safeParse({ ...response, sources: [{ ...response.sources[0], url: 'not a url' }] }).success).toBe(false);
    expect(chatResponseSchema.safeParse({ ...response, sources: [] }).success).toBe(true);
  });
});
