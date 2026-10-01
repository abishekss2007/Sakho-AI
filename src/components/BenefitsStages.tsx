'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import type { DictKey } from '@/lib/i18n';
import { applicableQuestions } from '@/lib/scheme/engine';
import { PMMVY_DOCUMENTS, PMMVY_HELPLINE, type DocumentId, type DocumentStatus } from '@/lib/scheme/pmmvy';
import type { EvaluationResult, Guidance, Reason } from '@/lib/scheme/types';
import { buildQrValue, shareText, type ShareOutcome } from '@/lib/share';
import { useApp } from './AppContext';
import { optionLabel, QUESTION_TEXT } from './benefitText';
import type { BenefitsState } from './types';
import { Button } from './ui/Button';
import { IconBadge } from './ui/Icon';
import { Card, Notice } from './ui/Notice';
import { useVoice } from './useVoice';

type Review = Extract<EvaluationResult, { status: 'review' }>;

const GUIDANCE_TEXT: Record<Guidance, DictKey> = {
  may_apply: 'resultMayApply',
  may_not_apply: 'resultMayNotApply',
  uncertain: 'resultUncertain',
};

const REASON_TEXT: Record<Reason, DictKey> = {
  not_pregnant_or_recent_birth: 'reason_not_pregnant_or_recent_birth',
  third_or_later_child: 'reason_third_or_later_child',
  second_child_not_girl: 'reason_second_child_not_girl',
  no_category_proof: 'reason_no_category_proof',
};

const DOCUMENT_TEXT: Record<DocumentId, DictKey> = {
  aadhaar: 'doc_aadhaar',
  bank_account: 'doc_bank_account',
  mobile: 'doc_mobile',
  mcp_card: 'doc_mcp_card',
  eligibility_proof: 'doc_eligibility_proof',
  birth_certificate: 'doc_birth_certificate',
  immunisation_record: 'doc_immunisation_record',
};

const STATUS_TEXT: Record<DocumentStatus, DictKey> = { have: 'docHave', need_help: 'docNeed', unknown: 'docUnknown' };

const SHARE_TEXT: Record<ShareOutcome, DictKey> = {
  shared: 'shareDone',
  cancelled: 'shareCancelled',
  unsupported: 'shareUnsupported',
  failed: 'shareFailed',
};

/** Phone numbers and web addresses keep their left-to-right order in any layout direction. */
function Ltr({ children }: { children: string }) {
  return <bdi dir="ltr">{children}</bdi>;
}

function Provenance({ result, bundled }: { result: Review; bundled: boolean }) {
  const { i18n } = useApp();
  const { t } = i18n;
  return (
    <Card>
      <h2 className="text-xl font-bold">{t('sourceTitle')}</h2>
      <p className="font-semibold text-accent">{t('notVerified')}</p>
      <p>{t('ruleVersion', { version: result.rules.ruleVersion })}</p>
      {bundled && <p>{t('offlineRules', { version: result.rules.ruleVersion })}</p>}
      <ul className="mt-2 list-disc ps-6">
        {result.rules.sources.map((source) => (
          <li key={source.id} lang="en" dir="ltr">
            <a className="text-primary underline" href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
            <span className="text-muted">
              {' '}
              ({source.publisher}). <span lang={i18n.uiLanguage}>{t('retrievedOn', { date: source.retrievedOn })}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ResultStage({
  result,
  bundled,
  onDocuments,
  onChange,
}: {
  result: Review;
  bundled: boolean;
  onDocuments(): void;
  onChange(): void;
}) {
  const { i18n } = useApp();
  const { t } = i18n;
  const voice = useVoice();
  const headline = t(GUIDANCE_TEXT[result.guidance]);

  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-4">
      <h1 id="result-title" className="text-3xl font-bold tracking-tight">
        {t('resultTitle')}
      </h1>

      <Card className={result.guidance === 'may_apply' ? 'border-t-8 border-t-primary' : 'border-t-8 border-t-accent'}>
        <div className="flex items-start gap-4">
          <IconBadge
            name={result.guidance === 'may_apply' ? 'shield' : 'question'}
            tone={result.guidance === 'may_apply' ? 'primary' : 'accent'}
          />
          <p className="min-w-0 flex-1 text-xl leading-snug font-bold">{headline}</p>
        </div>
        {result.reasons.length > 0 && (
          <ul className="mt-3 list-disc ps-6">
            {result.reasons.map((reason) => (
              <li key={reason}>{t(REASON_TEXT[reason])}</li>
            ))}
          </ul>
        )}
        {result.uncertainQuestions.length > 0 && <p className="mt-3">{t('uncertainBody')}</p>}
        <div className="mt-4">
          {voice.status === 'speaking' ? (
            <Button variant="secondary" size="md" icon="stop" onClick={voice.stop}>
              {t('stop')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              icon="speaker"
              onClick={() => void voice.speak(`${headline} ${t('resultNotApproval')} ${t('step1')}`, i18n.uiLanguage, true)}
            >
              {t('listen')}
            </Button>
          )}
        </div>
      </Card>

      <Notice tone="warning" live={false}>
        <p className="font-semibold">{t('resultNotApproval')}</p>
        <p>{t('resultDraft')}</p>
        <p>{t('resultNotAuthority')}</p>
      </Notice>
      {voice.notice && <Notice tone="warning">{t(voice.notice)}</Notice>}

      <Card>
        <h2 className="text-xl font-bold">{t('nextStepsTitle')}</h2>
        <ol className="mt-2 list-decimal ps-6">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>
            {t('step3').replace(PMMVY_HELPLINE, '')}
            <Ltr>{PMMVY_HELPLINE}</Ltr>
          </li>
        </ol>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t('notesTitle')}</h2>
        <ul className="mt-2 list-disc ps-6">
          <li>{t('noteAge')}</li>
          <li>{t('noteDeadline')}</li>
          <li>{t('noteStates')}</li>
        </ul>
      </Card>

      <Provenance result={result} bundled={bundled} />

      <Button icon="benefits" onClick={onDocuments}>
        {t('seeDocuments')}
      </Button>
      <Button variant="quiet" icon="refresh" onClick={onChange}>
        {t('changeAnswers')}
      </Button>
    </section>
  );
}

export function DocumentsStage({
  documents,
  onChange,
  onBack,
  onNext,
  hasGuidance,
}: {
  documents: Partial<Record<DocumentId, DocumentStatus>>;
  onChange(documents: Partial<Record<DocumentId, DocumentStatus>>): void;
  onBack(): void;
  onNext(): void;
  /** False when the papers list was opened before answering the questions. */
  hasGuidance: boolean;
}) {
  const { i18n } = useApp();
  const { t } = i18n;

  const toggle = (id: DocumentId, status: DocumentStatus) =>
    onChange({ ...documents, [id]: documents[id] === status ? 'unknown' : status });

  return (
    <section aria-labelledby="docs-title" className="flex flex-col gap-4">
      <h1 id="docs-title" className="text-3xl font-bold tracking-tight">
        {t('docsTitle')}
      </h1>
      <p>{t('docsIntro')}</p>
      <ul className="flex flex-col gap-3">
        {PMMVY_DOCUMENTS.map((id) => {
          const status = documents[id] ?? 'unknown';
          return (
            <li key={id}>
              <Card>
                <h2 className="text-lg font-bold">{t(DOCUMENT_TEXT[id])}</h2>
                <p className="text-muted">{t(STATUS_TEXT[status])}</p>
                <div className="mt-3 grid grid-cols-2 gap-3" role="group" aria-label={t(DOCUMENT_TEXT[id])}>
                  <Button size="md" pressed={status === 'have'} onClick={() => toggle(id, 'have')}>
                    {t('docHave')}
                  </Button>
                  <Button size="md" pressed={status === 'need_help'} onClick={() => toggle(id, 'need_help')}>
                    {t('docNeed')}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {hasGuidance ? (
        <>
          <Button icon="next" onClick={onNext}>
            {t('seeSummary')}
          </Button>
          <Button variant="quiet" icon="back" onClick={onBack}>
            {t('back')}
          </Button>
        </>
      ) : (
        <Button icon="next" onClick={onBack}>
          {t('homeBenefits')}
        </Button>
      )}
    </section>
  );
}

export function SummaryStage({
  state,
  result,
  onBack,
  onRestart,
}: {
  state: BenefitsState;
  result: Review;
  onBack(): void;
  onRestart(): void;
}) {
  const { i18n } = useApp();
  const { t } = i18n;
  const [includeAnswers, setIncludeAnswers] = useState(false);
  const [shareResult, setShareResult] = useState<ShareOutcome | null>(null);

  const answerLines = applicableQuestions(state.answers).map((q) => ({
    id: q.id,
    question: t(QUESTION_TEXT[q.id]),
    answer: optionLabel(t, q.id, state.answers[q.id] ?? 'unsure'),
  }));
  const documentLines = PMMVY_DOCUMENTS.map((id) => ({
    id,
    name: t(DOCUMENT_TEXT[id]),
    status: t(STATUS_TEXT[state.documents[id] ?? 'unknown']),
  }));
  const headline = t(GUIDANCE_TEXT[result.guidance]);

  const share = async () => {
    const text = [
      `${t('appName')} - ${t('summaryTitle')}`,
      `${headline} ${t('resultNotApproval')}`,
      ...answerLines.map((l) => `${l.question} ${l.answer}`),
      ...documentLines.map((l) => `${l.name}: ${l.status}`),
    ].join('\n');
    // The outcome is reported as is. A cancelled share is never retried another way.
    setShareResult(await shareText(t('summaryTitle'), text));
  };

  return (
    <section aria-labelledby="summary-title" className="flex flex-col gap-4">
      <h1 id="summary-title" className="text-3xl font-bold tracking-tight">
        {t('summaryTitle')}
      </h1>

      <Card>
        <h2 className="text-xl font-bold">{t('summaryGuidance')}</h2>
        <p className="font-semibold">{headline}</p>
        <p>{t('resultNotApproval')}</p>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t('summaryAnswers')}</h2>
        <dl className="mt-2">
          {answerLines.map((line) => (
            <div key={line.id} className="mb-2">
              <dt>{line.question}</dt>
              <dd className="font-bold">{line.answer}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">{t('summaryDocs')}</h2>
        <ul className="mt-2 list-disc ps-6">
          {documentLines.map((line) => (
            <li key={line.id}>
              {line.name}: <strong>{line.status}</strong>
            </li>
          ))}
        </ul>
      </Card>

      <Provenance result={result} bundled={state.bundled} />

      <Card>
        <h2 className="text-xl font-bold">{t('qrTitle')}</h2>
        <div className="my-3 inline-block rounded-2xl border border-line-soft bg-white p-3">
          <QRCodeSVG
            value={buildQrValue(includeAnswers, state.answers, state.documents)}
            size={200}
            level="M"
            title={t('qrAlt')}
          />
        </div>
        <p className="font-semibold">{includeAnswers ? t('qrPersonal') : t('qrDefaultExplain')}</p>
        <Notice tone="warning" live={false}>
          {t('qrWarning')}
        </Notice>
        <label className="mt-3 flex min-h-14 items-center gap-3 font-semibold">
          <input
            type="checkbox"
            className="size-7 shrink-0 accent-primary"
            checked={includeAnswers}
            onChange={(event) => setIncludeAnswers(event.target.checked)}
          />
          <span>{t('qrConsent')}</span>
        </label>
      </Card>

      <Card>
        <p>{t('shareWarning')}</p>
        <div className="mt-3">
          <Button variant="secondary" icon="send" onClick={() => void share()}>
            {t('share')}
          </Button>
        </div>
        <div aria-live="polite" className="mt-3">
          {shareResult && <p className="font-semibold">{t(SHARE_TEXT[shareResult])}</p>}
        </div>
      </Card>

      <Button variant="quiet" icon="back" onClick={onBack}>
        {t('back')}
      </Button>
      <Button variant="quiet" icon="refresh" onClick={onRestart}>
        {t('startAgain')}
      </Button>
    </section>
  );
}
