export const QUESTION_IDS = [
  'pregnant_or_recent_birth',
  'child_order',
  'second_child_girl',
  'has_category_proof',
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export type Answers = Partial<Record<QuestionId, string>>;

/**
 * Every question is exposed through this one explicit type, so optional
 * members such as `askIf` are always safely accessible under strict mode.
 */
export interface Question {
  id: QuestionId;
  /** Allowed answer values, in display order. */
  options: readonly string[];
  /** When present and false, the question does not apply and must not be answered. */
  askIf?: (answers: Answers) => boolean;
}

export interface SourceRef {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** ISO date on which the source was read. */
  retrievedOn: string;
}

export interface RuleProvenance {
  schemeId: 'pmmvy';
  ruleVersion: string;
  /** `draft` rules may only ever produce preliminary guidance. */
  rulesStatus: 'draft' | 'verified';
  reviewStatus: 'not_officially_reviewed' | 'officially_reviewed';
  /** Date an authorised reviewer verified the rules; `null` means never. */
  lastVerified: string | null;
  geographicScope: string;
  sources: readonly SourceRef[];
}

export type Guidance = 'may_apply' | 'may_not_apply' | 'uncertain';

export type Reason =
  | 'not_pregnant_or_recent_birth'
  | 'third_or_later_child'
  | 'second_child_not_girl'
  | 'no_category_proof';

export type EvaluationResult =
  | {
      status: 'questions_remaining';
      nextQuestionId: QuestionId;
      answered: number;
      total: number;
    }
  | {
      status: 'needs_clarification';
      /** Answers given to questions that do not apply given the other answers. */
      conflicts: QuestionId[];
    }
  | {
      status: 'review';
      guidance: Guidance;
      reasons: Reason[];
      uncertainQuestions: QuestionId[];
      /** Always false: Sakho is never an approval authority. */
      official: false;
      requiresOfficialReview: true;
      rules: RuleProvenance;
    };
