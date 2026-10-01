import { PMMVY_PORTAL_URL, PMMVY_PROVENANCE, type DocumentId, type DocumentStatus } from '@/lib/scheme/pmmvy';
import type { Answers } from '@/lib/scheme/types';

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

type ShareCapable = { share?: (data: { title?: string; text?: string }) => Promise<void> };

/**
 * Open the device share sheet. Dismissing the sheet is a decision, so it is
 * reported as `cancelled` and no other channel is ever tried.
 */
export async function shareText(
  title: string,
  text: string,
  nav: ShareCapable | undefined = typeof navigator === 'undefined' ? undefined : (navigator as ShareCapable),
): Promise<ShareOutcome> {
  if (!nav || typeof nav.share !== 'function') return 'unsupported';
  try {
    await nav.share({ title, text });
    return 'shared';
  } catch (error) {
    return (error as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export const QR_PREFIX = 'SAKHO1';

/**
 * QR content. By default it is only the official portal address. Answers
 * describe pregnancy and family circumstances, so they are embedded only when
 * the user has explicitly opted in.
 */
export function buildQrValue(
  includePersonal: boolean,
  answers: Answers,
  documents: Partial<Record<DocumentId, DocumentStatus>>,
): string {
  if (!includePersonal) return PMMVY_PORTAL_URL;
  const answerPart = Object.entries(answers)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  const docPart = Object.entries(documents)
    .filter(([, status]) => status !== 'unknown')
    .map(([k, v]) => `${k}=${v}`)
    .join(';');
  return [QR_PREFIX, 'pmmvy', PMMVY_PROVENANCE.ruleVersion, answerPart, docPart].join('|');
}
