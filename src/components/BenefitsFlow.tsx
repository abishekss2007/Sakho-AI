'use client';

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { LIMITS } from '@/lib/api/contracts';
import { ApiClientError } from '@/lib/client/api';
import type { DictKey } from '@/lib/i18n';
import { applicableQuestions, applyAnswer, evaluate, getQuestion, rewindTo } from '@/lib/scheme/engine';
import { PMMVY_CATEGORIES } from '@/lib/scheme/pmmvy';
import type { Answers, EvaluationResult, QuestionId } from '@/lib/scheme/types';
import { useApp } from './AppContext';
import { CATEGORY_TEXT, optionLabel, QUESTION_TEXT } from './benefitText';
import { DocumentsStage, ResultStage, SummaryStage } from './BenefitsStages';
import { EMPTY_BENEFITS, type BenefitsState } from './types';
import { Button } from './ui/Button';
import { IconBadge, type IconName } from './ui/Icon';
import { Card, Notice } from './ui/Notice';
import { useVoice } from './useVoice';

function newSessionId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}00000000`;
  return random.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

const OPTION_ICON: Record<string, IconName> = {
  yes: 'check',
  no: 'close',
  unsure: 'question',
  first: 'sparkle',
  second: 'sparkle',
  third_or_later: 'sparkle',
};

type FlowNotice = { key: DictKey; tone: 'info' | 'warning' | 'danger'; help?: boolean };

export function BenefitsFlow({
  state,
  setState,
}: {
  state: BenefitsState;
  setState: Dispatch<SetStateAction<BenefitsState>>;
}) {
  const { i18n, prefs, api, openSos, onInterrupt } = useApp();
  const { t } = i18n;
  const voice = useVoice();

  const [pending, setPending] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [notice, setNotice] = useState<FlowNotice | null>(null);
  const [typed, setTyped] = useState('');
  const [sessionId] = useState(newSessionId);

  const pendingRef = useRef(false);
  /** Bumped whenever the question can change; an interpretation with an older number is stale. */
  const sequence = useRef(0);
  const checkAbort = useRef<AbortController | null>(null);
  const understandAbort = useRef<AbortController | null>(null);

  const questionId = state.result?.status === 'questions_remaining' ? state.result.nextQuestionId : null;
  const questionRef = useRef(questionId);
  useEffect(() => {
    questionRef.current = questionId;
  }, [questionId]);

  // A new question or stage starts at the top of the page.
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [questionId, state.stage]);

  useEffect(() => {
    const cancel = () => {
      sequence.current += 1;
      checkAbort.current?.abort();
      understandAbort.current?.abort();
      setInterpreting(false);
    };
    const remove = onInterrupt(cancel);
    return () => {
      remove();
      sequence.current += 1;
      checkAbort.current?.abort();
      understandAbort.current?.abort();
    };
  }, [onInterrupt]);

  const speakQuestion = (id: QuestionId) => {
    const extra = id === 'has_category_proof' ? ` ${PMMVY_CATEGORIES.map((c) => t(CATEGORY_TEXT[c])).join('. ')}.` : '';
    void voice.speak(`${t(QUESTION_TEXT[id])}${extra}`, i18n.uiLanguage);
  };

  /** Ask the server to evaluate. Answers are committed together with its result, never before. */
  const runCheck = async (answers: Answers, cleared = false) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    // Any interpretation still in flight belongs to the question being left.
    sequence.current += 1;
    understandAbort.current?.abort();
    setInterpreting(false);

    const controller = new AbortController();
    checkAbort.current = controller;
    let result: EvaluationResult;
    let bundled = false;
    try {
      result = (await api.schemeCheck({ schemeId: 'pmmvy', answers }, controller.signal)).result;
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'aborted') {
        pendingRef.current = false;
        setPending(false);
        return;
      }
      // Server unreachable: the same engine, bundled in the page, keeps the buttons working.
      result = evaluate(answers);
      bundled = true;
    }
    pendingRef.current = false;
    setPending(false);

    if (result.status === 'needs_clarification') {
      setState((s) => ({ ...s, stage: 'question', answers: {}, result: evaluate({}), bundled }));
      setNotice({ key: 'clarifyNeeded', tone: 'warning' });
      return;
    }
    setState((s) => ({ ...s, stage: result.status === 'review' ? 'result' : 'question', answers, result, bundled }));
    setNotice(cleared ? { key: 'answerCleared', tone: 'info' } : null);
    if (prefs.autoRead && result.status === 'questions_remaining') speakQuestion(result.nextQuestionId);
  };

  const answer = (id: QuestionId, value: string) => {
    if (pendingRef.current || id !== questionRef.current) return;
    const { answers, cleared } = applyAnswer(state.answers, id, value);
    void runCheck(answers, cleared.length > 0);
  };

  const goBack = () => {
    const answered = applicableQuestions(state.answers).filter((q) => state.answers[q.id] !== undefined);
    const previous = answered[answered.length - 1];
    if (!previous) {
      voice.stop();
      setState((s) => ({ ...s, stage: 'intro' }));
      return;
    }
    void runCheck(rewindTo(state.answers, previous.id));
  };

  /** Interpret a spoken or typed reply. The result is applied only if it is still for the question on screen. */
  const interpret = async (utterance: string) => {
    const asked = questionRef.current;
    const text = utterance.trim().slice(0, LIMITS.utteranceChars);
    if (!asked || !text || pendingRef.current) return;

    const token = (sequence.current += 1);
    understandAbort.current?.abort();
    const controller = new AbortController();
    understandAbort.current = controller;
    setInterpreting(true);
    setNotice(null);
    try {
      const response = await api.understand(
        { schemeId: 'pmmvy', questionId: asked, utterance: text, locale: i18n.selected, sessionId },
        controller.signal,
      );
      const stale =
        token !== sequence.current || response.questionId !== questionRef.current || response.sessionId !== sessionId;
      if (stale) return;
      const result = response.interpretation;
      if (result.kind === 'answer' && getQuestion(asked).options.includes(result.value)) {
        setInterpreting(false);
        answer(asked, result.value);
      } else if (result.kind === 'repeat') {
        speakQuestion(asked);
      } else if (result.kind === 'emergency_suggestion') {
        // A suggestion only: the user decides whether to open emergency help.
        setNotice({ key: 'emergencySuggest', tone: 'danger', help: true });
      } else {
        setNotice({ key: 'answerUnclear', tone: 'warning' });
      }
    } catch (caught) {
      const aborted = caught instanceof ApiClientError && caught.code === 'aborted';
      if (!aborted && token === sequence.current) setNotice({ key: 'answerUnclear', tone: 'warning' });
    } finally {
      if (token === sequence.current) setInterpreting(false);
    }
  };

  const onTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = typed;
    setTyped('');
    void interpret(text);
  };

  const restart = () => {
    voice.stop();
    setNotice(null);
    setState(EMPTY_BENEFITS);
  };

  const heading = (
    <h1 id="benefits-title" className="text-3xl font-extrabold tracking-tight">
      {t('benefitsTitle')}
    </h1>
  );

  if (state.stage === 'result' && state.result?.status === 'review') {
    return (
      <ResultStage
        result={state.result}
        bundled={state.bundled}
        onDocuments={() => setState((s) => ({ ...s, stage: 'documents' }))}
        onChange={restart}
      />
    );
  }
  if (state.stage === 'documents') {
    return (
      <DocumentsStage
        documents={state.documents}
        onChange={(documents) => setState((s) => ({ ...s, documents }))}
        onBack={() => setState((s) => ({ ...s, stage: 'result' }))}
        onNext={() => setState((s) => ({ ...s, stage: 'summary' }))}
      />
    );
  }
  if (state.stage === 'summary' && state.result?.status === 'review') {
    return (
      <SummaryStage
        state={state}
        result={state.result}
        onBack={() => setState((s) => ({ ...s, stage: 'documents' }))}
        onRestart={restart}
      />
    );
  }

  if (state.stage === 'intro' || !questionId || state.result?.status !== 'questions_remaining') {
    return (
      <section aria-labelledby="benefits-title" className="flex flex-col gap-4">
        {heading}
        <Card>
          <div className="flex items-start gap-4">
            <IconBadge name="benefits" tone="accent" size="lg" />
            <p className="min-w-0 flex-1 text-lg">{t('benefitsIntro')}</p>
          </div>
        </Card>
        <Notice tone="warning" live={false}>
          {t('resultNotAuthority')} {t('resultDraft')}
        </Notice>
        <Button icon="next" disabled={pending} onClick={() => void runCheck(state.answers)}>
          {pending ? t('checking') : t('continue')}
        </Button>
      </section>
    );
  }

  const question = getQuestion(questionId);
  const { answered, total } = state.result;

  return (
    <section aria-labelledby="benefits-title" className="flex flex-col gap-4">
      {heading}
      <p className="inline-flex self-start rounded-full bg-primary-soft px-4 py-1 font-bold text-primary">
        {t('questionOf', { n: answered + 1, total })}
      </p>
      <progress className="w-full" max={total} value={answered} aria-label={t('questionOf', { n: answered + 1, total })} />

      {state.bundled && (
        <Notice tone="warning" live={false}>
          {t('offlineRules', { version: 'pmmvy-draft-2026-10-01' })}
        </Notice>
      )}

      <Card>
        <h2 className="text-2xl leading-snug font-extrabold">{t(QUESTION_TEXT[questionId])}</h2>
        {questionId === 'has_category_proof' && (
          <ul className="mt-3 list-disc ps-6">
            {PMMVY_CATEGORIES.map((category) => (
              <li key={category}>{t(CATEGORY_TEXT[category])}</li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          {voice.status === 'speaking' ? (
            <Button variant="secondary" size="md" icon="stop" onClick={voice.stop}>
              {t('stop')}
            </Button>
          ) : (
            <Button variant="secondary" size="md" icon="speaker" onClick={() => speakQuestion(questionId)}>
              {t('listenAgain')}
            </Button>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        {question.options.map((value) => (
          <Button
            key={value}
            variant="secondary"
            block
            align="start"
            icon={OPTION_ICON[value]}
            className="min-h-16 text-xl"
            disabled={pending}
            onClick={() => answer(questionId, value)}
          >
            {optionLabel(t, questionId, value)}
          </Button>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {pending && <p className="font-semibold">{t('checking')}</p>}
        {interpreting && <p className="font-semibold">{t('micProcessing')}</p>}
        {notice && (
          <Notice tone={notice.tone}>
            <p>{t(notice.key)}</p>
            {notice.help && (
              <div className="mt-3">
                <Button variant="danger" icon="phone" onClick={openSos}>
                  {t('getHelp')}
                </Button>
              </div>
            )}
          </Notice>
        )}
        {voice.notice && <Notice tone="warning">{t(voice.notice)}</Notice>}
        {voice.status === 'listening' && (
          <Notice tone="info" icon="mic">
            <p className="font-semibold">{t('micListening')}</p>
            {voice.showMicExplanation && <p>{t('micPermissionExplain')}</p>}
          </Notice>
        )}
      </div>

      <form onSubmit={onTyped} className="flex flex-col gap-3">
        <label htmlFor="benefit-typed" className="font-semibold">
          {t('typeAnswerLabel')}
        </label>
        <input
          id="benefit-typed"
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          maxLength={LIMITS.utteranceChars}
          autoComplete="off"
          className="min-h-14 w-full rounded-2xl border-2 border-line bg-card px-4 text-lg shadow-card"
        />
        <div className="grid grid-cols-2 gap-3">
          {voice.status === 'listening' ? (
            <Button variant="secondary" icon="stop" onClick={voice.stop}>
              {t('stop')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon="mic"
              disabled={pending}
              onClick={() => voice.listen(i18n.selected, (transcript) => void interpret(transcript))}
            >
              {t('speak')}
            </Button>
          )}
          <Button type="submit" variant="secondary" icon="send" disabled={pending || typed.trim().length === 0}>
            {t('send')}
          </Button>
        </div>
      </form>

      <Button variant="quiet" icon="back" disabled={pending} onClick={goBack}>
        {t('back')}
      </Button>
    </section>
  );
}
