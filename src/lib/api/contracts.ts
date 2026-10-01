import { z } from 'zod';
import { EMERGENCY_SERVICE_IDS } from '@/lib/emergency';
import { LANGUAGE_CODES } from '@/lib/languages';
import { PMMVY_QUESTIONS } from '@/lib/scheme/pmmvy';
import { QUESTION_IDS } from '@/lib/scheme/types';

/**
 * Runtime contracts for every API endpoint. Requests are validated on the
 * server and responses are validated again in the browser, so neither side
 * relies on TypeScript casts.
 */

export const LIMITS = {
  chatMessages: 12,
  chatMessageChars: 1000,
  chatTotalChars: 6000,
  chatReplyChars: 2000,
  utteranceChars: 300,
  ttsChars: 600,
  bodyBytes: 16 * 1024,
} as const;

export const localeSchema = z.enum(LANGUAGE_CODES);
const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

// ---- Errors ---------------------------------------------------------------

export const ERROR_CODES = [
  'invalid_json',
  'invalid_request',
  'unsupported_media_type',
  'payload_too_large',
  'forbidden_origin',
  'rate_limited',
  'budget_exhausted',
  'provider_unavailable',
  'provider_rate_limited',
  'provider_timeout',
  'provider_bad_response',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_json: 400,
  invalid_request: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  forbidden_origin: 403,
  rate_limited: 429,
  budget_exhausted: 503,
  provider_unavailable: 503,
  provider_rate_limited: 503,
  provider_timeout: 504,
  provider_bad_response: 502,
  internal_error: 500,
};

export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  requestId: z.string(),
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// ---- /api/scheme/check ----------------------------------------------------

function optionEnum(id: (typeof QUESTION_IDS)[number]) {
  const question = PMMVY_QUESTIONS.find((q) => q.id === id);
  if (!question) throw new Error(`Missing question ${id}`);
  return z.enum(question.options as [string, ...string[]]).optional();
}

export const answersSchema = z.strictObject({
  pregnant_or_recent_birth: optionEnum('pregnant_or_recent_birth'),
  child_order: optionEnum('child_order'),
  second_child_girl: optionEnum('second_child_girl'),
  has_category_proof: optionEnum('has_category_proof'),
});

export const schemeCheckRequestSchema = z.strictObject({
  schemeId: z.literal('pmmvy'),
  answers: answersSchema,
});
export type SchemeCheckRequest = z.infer<typeof schemeCheckRequestSchema>;

const questionIdSchema = z.enum(QUESTION_IDS);

const sourceRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.string().url(),
  retrievedOn: z.string(),
});

const provenanceSchema = z.object({
  schemeId: z.literal('pmmvy'),
  ruleVersion: z.string(),
  rulesStatus: z.enum(['draft', 'verified']),
  reviewStatus: z.enum(['not_officially_reviewed', 'officially_reviewed']),
  lastVerified: z.string().nullable(),
  geographicScope: z.string(),
  sources: z.array(sourceRefSchema),
});

export const evaluationResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('questions_remaining'),
    nextQuestionId: questionIdSchema,
    answered: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  z.object({
    status: z.literal('needs_clarification'),
    conflicts: z.array(questionIdSchema).min(1),
  }),
  z.object({
    status: z.literal('review'),
    guidance: z.enum(['may_apply', 'may_not_apply', 'uncertain']),
    reasons: z.array(
      z.enum([
        'not_pregnant_or_recent_birth',
        'third_or_later_child',
        'second_child_not_girl',
        'no_category_proof',
      ]),
    ),
    uncertainQuestions: z.array(questionIdSchema),
    official: z.literal(false),
    requiresOfficialReview: z.literal(true),
    rules: provenanceSchema,
  }),
]);

export const schemeCheckResponseSchema = z.object({
  ok: z.literal(true),
  requestId: z.string(),
  result: evaluationResultSchema,
});
export type SchemeCheckResponse = z.infer<typeof schemeCheckResponseSchema>;

// ---- /api/understand ------------------------------------------------------

export const understandRequestSchema = z.strictObject({
  schemeId: z.literal('pmmvy'),
  questionId: questionIdSchema,
  utterance: z.string().trim().min(1).max(LIMITS.utteranceChars),
  locale: localeSchema,
  sessionId: sessionIdSchema,
});
export type UnderstandRequest = z.infer<typeof understandRequestSchema>;

export const interpretationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), value: z.string() }),
  z.object({ kind: z.literal('repeat') }),
  z.object({ kind: z.literal('unclear') }),
  z.object({ kind: z.literal('emergency_suggestion'), serviceId: z.enum(EMERGENCY_SERVICE_IDS) }),
]);
export type Interpretation = z.infer<typeof interpretationSchema>;

export const understandResponseSchema = z.object({
  ok: z.literal(true),
  requestId: z.string(),
  /** Echoed so the browser can discard a reply that arrives for an old question. */
  questionId: questionIdSchema,
  sessionId: z.string(),
  interpretation: interpretationSchema,
  via: z.enum(['keywords', 'model']),
});
export type UnderstandResponse = z.infer<typeof understandResponseSchema>;

// ---- /api/tts -------------------------------------------------------------

export const SPEEDS = ['slow', 'normal', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];
export const SPEAKING_RATE: Record<Speed, number> = { slow: 0.8, normal: 1, fast: 1.2 };

export const ttsRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(LIMITS.ttsChars),
  locale: localeSchema,
  speed: z.enum(SPEEDS),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

// ---- /api/chat ------------------------------------------------------------

export const chatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(LIMITS.chatMessageChars),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z
  .strictObject({
    messages: z.array(chatMessageSchema).min(1).max(LIMITS.chatMessages),
    locale: localeSchema,
    inputMode: z.enum(['text', 'voice']),
  })
  .refine((v) => v.messages[v.messages.length - 1]?.role === 'user', {
    message: 'The last message must be from the user.',
  })
  .refine((v) => v.messages.reduce((n, m) => n + m.text.length, 0) <= LIMITS.chatTotalChars, {
    message: 'Conversation is too long.',
  });
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  ok: z.literal(true),
  requestId: z.string(),
  reply: z.object({ text: z.string().min(1), language: localeSchema }),
  /** Only sources from the server's verified registry; never model-written URLs. */
  sources: z.array(
    z.object({ id: z.string(), title: z.string(), publisher: z.string(), url: z.string().url() }),
  ),
  safety: z.object({ urgent: z.boolean() }),
  needsClarification: z.boolean(),
  provider: z.enum(['gemini', 'mock']),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

// ---- /api/health ----------------------------------------------------------

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('sakho-ai'),
  providers: z.enum(['live', 'mock']),
  sosMode: z.enum(['demo', 'live']),
  rateLimit: z.enum(['shared', 'per-instance']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
