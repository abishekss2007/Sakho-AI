import { LIMITS, type ChatMessage, type ChatResponse } from '@/lib/api/contracts';
import type { LanguageCode } from '@/lib/languages';
import type { DocumentId, DocumentStatus } from '@/lib/scheme/pmmvy';
import type { Answers, EvaluationResult } from '@/lib/scheme/types';

export type Screen = 'language' | 'home' | 'chat' | 'benefits' | 'settings';

/** Chat lives in memory only and is erased on reload or "Erase". */
export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: LanguageCode;
  sources: ChatResponse['sources'];
  urgent: boolean;
}

/** Questionnaire progress. In memory only. */
export interface BenefitsState {
  stage: 'intro' | 'question' | 'result' | 'documents' | 'summary';
  answers: Answers;
  documents: Partial<Record<DocumentId, DocumentStatus>>;
  result: EvaluationResult | null;
  /** True when the last evaluation used the rules bundled in the page instead of the server. */
  bundled: boolean;
}

export const EMPTY_BENEFITS: BenefitsState = {
  stage: 'intro',
  answers: {},
  documents: {},
  result: null,
  bundled: false,
};

/**
 * The slice of conversation sent to the server: the most recent messages,
 * within the count and size limits, starting with a user message.
 */
export function boundHistory(items: readonly Pick<ChatItem, 'role' | 'text'>[]): ChatMessage[] {
  let history = items.slice(-LIMITS.chatMessages).map((m) => ({ role: m.role, text: m.text }));
  const total = () => history.reduce((n, m) => n + m.text.length, 0);
  while (history.length > 1 && (total() > LIMITS.chatTotalChars || history[0]?.role !== 'user')) {
    history = history.slice(1);
  }
  return history;
}
