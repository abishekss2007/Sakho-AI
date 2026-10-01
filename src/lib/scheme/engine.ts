import { PMMVY_PROVENANCE, PMMVY_QUESTIONS } from './pmmvy';
import type { Answers, EvaluationResult, Question, QuestionId, Reason } from './types';

/**
 * The single authoritative rules implementation. It is pure and has no
 * environment dependencies, so the API route and the offline fallback in the
 * browser run exactly the same code.
 */

export function getQuestions(): readonly Question[] {
  return PMMVY_QUESTIONS;
}

export function getQuestion(id: QuestionId): Question {
  const question = PMMVY_QUESTIONS.find((q) => q.id === id);
  if (!question) throw new Error(`Unknown question: ${id}`);
  return question;
}

function applies(question: Question, answers: Answers): boolean {
  return question.askIf ? question.askIf(answers) : true;
}

/** Questions that apply given the current answers, in order. */
export function applicableQuestions(answers: Answers): Question[] {
  return PMMVY_QUESTIONS.filter((q) => applies(q, answers));
}

export function isValidAnswer(id: QuestionId, value: string): boolean {
  return getQuestion(id).options.includes(value);
}

/**
 * Record an answer and drop any later answers that no longer apply, so a
 * changed answer can never leave a stale dependent answer behind.
 */
export function applyAnswer(
  answers: Answers,
  id: QuestionId,
  value: string,
): { answers: Answers; cleared: QuestionId[] } {
  if (!isValidAnswer(id, value)) throw new Error(`Invalid answer for ${id}`);
  const next: Answers = { ...answers, [id]: value };
  const cleared: QuestionId[] = [];
  // Removing one answer can change whether another applies, so repeat until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of PMMVY_QUESTIONS) {
      if (next[q.id] !== undefined && !applies(q, next)) {
        delete next[q.id];
        cleared.push(q.id);
        changed = true;
      }
    }
  }
  return { answers: next, cleared };
}

/** Remove the answer to `id` and everything asked after it. */
export function rewindTo(answers: Answers, id: QuestionId): Answers {
  const index = PMMVY_QUESTIONS.findIndex((q) => q.id === id);
  const next: Answers = {};
  PMMVY_QUESTIONS.slice(0, index).forEach((q) => {
    const value = answers[q.id];
    if (value !== undefined) next[q.id] = value;
  });
  return next;
}

/**
 * Evaluate answers. Incomplete input always yields `questions_remaining`;
 * complete input yields preliminary `review` guidance and never an
 * eligibility determination.
 */
export function evaluate(answers: Answers): EvaluationResult {
  const conflicts = PMMVY_QUESTIONS.filter(
    (q) => answers[q.id] !== undefined && !applies(q, answers),
  ).map((q) => q.id);
  if (conflicts.length > 0) return { status: 'needs_clarification', conflicts };

  const applicable = applicableQuestions(answers);
  const next = applicable.find((q) => answers[q.id] === undefined);
  if (next) {
    return {
      status: 'questions_remaining',
      nextQuestionId: next.id,
      answered: applicable.filter((q) => answers[q.id] !== undefined).length,
      total: applicable.length,
    };
  }

  const reasons: Reason[] = [];
  if (answers.pregnant_or_recent_birth === 'no') reasons.push('not_pregnant_or_recent_birth');
  if (answers.child_order === 'third_or_later') reasons.push('third_or_later_child');
  if (answers.child_order === 'second' && answers.second_child_girl === 'no') {
    reasons.push('second_child_not_girl');
  }
  if (answers.has_category_proof === 'no') reasons.push('no_category_proof');

  const uncertainQuestions = applicable.filter((q) => answers[q.id] === 'unsure').map((q) => q.id);

  const guidance =
    reasons.length > 0 ? 'may_not_apply' : uncertainQuestions.length > 0 ? 'uncertain' : 'may_apply';

  return {
    status: 'review',
    guidance,
    reasons,
    uncertainQuestions,
    official: false,
    requiresOfficialReview: true,
    rules: PMMVY_PROVENANCE,
  };
}
