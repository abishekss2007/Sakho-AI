import { describe, expect, it } from 'vitest';
import { applicableQuestions, applyAnswer, evaluate, getQuestions, rewindTo } from '@/lib/scheme/engine';
import { PMMVY_PROVENANCE } from '@/lib/scheme/pmmvy';
import type { Answers } from '@/lib/scheme/types';

function review(answers: Answers) {
  const result = evaluate(answers);
  if (result.status !== 'review') throw new Error(`expected review, got ${result.status}`);
  return result;
}

/** Every combination of answers, including unanswered, for exhaustive checks. */
function allCombinations(): Answers[] {
  const combos: Answers[] = [{}];
  for (const q of getQuestions()) {
    const next: Answers[] = [];
    for (const base of combos) {
      next.push(base);
      for (const option of q.options) next.push({ ...base, [q.id]: option });
    }
    combos.splice(0, combos.length, ...next);
  }
  return combos;
}

describe('incomplete input never produces guidance', () => {
  it('asks the first question for empty input (regression: empty answers once returned "eligible")', () => {
    expect(evaluate({})).toEqual({
      status: 'questions_remaining',
      nextQuestionId: 'pregnant_or_recent_birth',
      answered: 0,
      total: 4 - 1, // the second-child question does not apply yet
    });
  });

  it('keeps asking until every applicable question is answered', () => {
    expect(evaluate({ pregnant_or_recent_birth: 'yes' })).toMatchObject({
      status: 'questions_remaining',
      nextQuestionId: 'child_order',
    });
    expect(evaluate({ pregnant_or_recent_birth: 'yes', child_order: 'second' })).toMatchObject({
      status: 'questions_remaining',
      nextQuestionId: 'second_child_girl',
      total: 4,
    });
    expect(evaluate({ pregnant_or_recent_birth: 'yes', child_order: 'first' })).toMatchObject({
      status: 'questions_remaining',
      nextQuestionId: 'has_category_proof',
    });
  });

  it('holds for every possible combination of answers', () => {
    for (const answers of allCombinations()) {
      const result = evaluate(answers);
      const applicable = applicableQuestions(answers);
      const complete = applicable.every((q) => answers[q.id] !== undefined);
      const conflicting = getQuestions().some((q) => answers[q.id] !== undefined && !applicable.includes(q));
      if (conflicting) expect(result.status).toBe('needs_clarification');
      else if (!complete) expect(result.status).toBe('questions_remaining');
      else expect(result.status).toBe('review');
      // No outcome ever claims eligibility or approval.
      expect(JSON.stringify(result)).not.toMatch(/"eligible"|approved/i);
    }
  });
});

describe('branches', () => {
  it('first child with a proof: answers match the published conditions', () => {
    const result = review({ pregnant_or_recent_birth: 'yes', child_order: 'first', has_category_proof: 'yes' });
    expect(result.guidance).toBe('may_apply');
    expect(result.reasons).toEqual([]);
  });

  it('second child who is a girl', () => {
    const result = review({
      pregnant_or_recent_birth: 'yes',
      child_order: 'second',
      second_child_girl: 'yes',
      has_category_proof: 'yes',
    });
    expect(result.guidance).toBe('may_apply');
  });

  it('second child who is not a girl ends early', () => {
    const result = review({ pregnant_or_recent_birth: 'yes', child_order: 'second', second_child_girl: 'no' });
    expect(result.guidance).toBe('may_not_apply');
    expect(result.reasons).toEqual(['second_child_not_girl']);
  });

  it('third or later child ends early', () => {
    const result = review({ pregnant_or_recent_birth: 'yes', child_order: 'third_or_later' });
    expect(result.reasons).toEqual(['third_or_later_child']);
  });

  it('not pregnant and no recent birth ends after one question', () => {
    const result = review({ pregnant_or_recent_birth: 'no' });
    expect(result.guidance).toBe('may_not_apply');
    expect(result.reasons).toEqual(['not_pregnant_or_recent_birth']);
  });

  it('no category proof', () => {
    const result = review({ pregnant_or_recent_birth: 'yes', child_order: 'first', has_category_proof: 'no' });
    expect(result.reasons).toEqual(['no_category_proof']);
  });

  it('preserves uncertainty instead of guessing', () => {
    const result = review({
      pregnant_or_recent_birth: 'unsure',
      child_order: 'second',
      second_child_girl: 'unsure',
      has_category_proof: 'yes',
    });
    expect(result.guidance).toBe('uncertain');
    expect(result.uncertainQuestions).toEqual(['pregnant_or_recent_birth', 'second_child_girl']);
  });

  it('a definite exclusion outranks an uncertain answer', () => {
    const result = review({ pregnant_or_recent_birth: 'unsure', child_order: 'third_or_later' });
    expect(result.guidance).toBe('may_not_apply');
  });
});

describe('draft status and provenance', () => {
  it('every review is preliminary and needs official review', () => {
    const result = review({ pregnant_or_recent_birth: 'yes', child_order: 'first', has_category_proof: 'yes' });
    expect(result.official).toBe(false);
    expect(result.requiresOfficialReview).toBe(true);
    expect(result.rules.rulesStatus).toBe('draft');
    expect(result.rules.reviewStatus).toBe('not_officially_reviewed');
  });

  it('has no invented verification date (regression: FILL_BEFORE_DEMO placeholder)', () => {
    expect(PMMVY_PROVENANCE.lastVerified).toBeNull();
    expect(JSON.stringify(PMMVY_PROVENANCE)).not.toContain('FILL_BEFORE_DEMO');
  });

  it('cites government sources with retrieval dates', () => {
    for (const source of PMMVY_PROVENANCE.sources) {
      expect(new URL(source.url).hostname).toMatch(/\.gov\.in$/);
      expect(source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('contradictions and answer changes', () => {
  it('asks for clarification when an answer is given to a question that does not apply', () => {
    expect(evaluate({ pregnant_or_recent_birth: 'yes', child_order: 'first', second_child_girl: 'yes' })).toEqual({
      status: 'needs_clarification',
      conflicts: ['second_child_girl'],
    });
    expect(evaluate({ pregnant_or_recent_birth: 'no', child_order: 'first' })).toMatchObject({
      status: 'needs_clarification',
    });
  });

  it('clears dependent answers when an earlier answer changes', () => {
    const before: Answers = {
      pregnant_or_recent_birth: 'yes',
      child_order: 'second',
      second_child_girl: 'yes',
      has_category_proof: 'yes',
    };
    const changed = applyAnswer(before, 'child_order', 'first');
    expect(changed.cleared).toEqual(['second_child_girl']);
    expect(changed.answers).toEqual({ pregnant_or_recent_birth: 'yes', child_order: 'first', has_category_proof: 'yes' });

    const none = applyAnswer(before, 'pregnant_or_recent_birth', 'no');
    expect(none.answers).toEqual({ pregnant_or_recent_birth: 'no' });
    expect(none.cleared.sort()).toEqual(['child_order', 'has_category_proof', 'second_child_girl']);
  });

  it('never leaves a state that needs clarification after applyAnswer', () => {
    for (const answers of allCombinations()) {
      if (evaluate(answers).status === 'needs_clarification') continue;
      for (const q of applicableQuestions(answers)) {
        for (const option of q.options) {
          expect(evaluate(applyAnswer(answers, q.id, option).answers).status).not.toBe('needs_clarification');
        }
      }
    }
  });

  it('rejects values that are not options', () => {
    expect(() => applyAnswer({}, 'child_order', 'fifth')).toThrow();
  });

  it('rewinds to an earlier question', () => {
    expect(
      rewindTo({ pregnant_or_recent_birth: 'yes', child_order: 'first', has_category_proof: 'yes' }, 'child_order'),
    ).toEqual({ pregnant_or_recent_birth: 'yes' });
  });
});

describe('question typing', () => {
  it('exposes optional askIf on every question through the Question type', () => {
    const flags = getQuestions().map((q) => q.askIf?.({}) ?? true);
    expect(flags).toHaveLength(4);
  });
});
