'use client';

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { LIMITS } from '@/lib/api/contracts';
import { ApiClientError, type ClientErrorCode } from '@/lib/client/api';
import type { DictKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/languages';
import { useApp } from './AppContext';
import { boundHistory, type ChatItem } from './types';
import { Button } from './ui/Button';
import { BrandMark } from './ui/Icon';
import { Notice } from './ui/Notice';
import { SafeText } from './ui/SafeText';
import { useVoice } from './useVoice';

function errorMessage(code: ClientErrorCode): DictKey {
  switch (code) {
    case 'rate_limited':
      return 'chatErrRate';
    case 'provider_unavailable':
    case 'provider_rate_limited':
    case 'budget_exhausted':
      return 'chatErrUnavailable';
    case 'provider_timeout':
      return 'chatErrTimeout';
    case 'network':
      return 'chatErrOffline';
    default:
      return 'chatErrGeneric';
  }
}

const SUGGESTIONS: readonly DictKey[] = ['sug1', 'sug2', 'sug3'];

export function ChatScreen({
  messages,
  setMessages,
  autoListen = false,
  onAutoListenUsed,
}: {
  messages: ChatItem[];
  setMessages: Dispatch<SetStateAction<ChatItem[]>>;
  /** Start listening as soon as the screen opens (the home talk button was pressed). */
  autoListen?: boolean;
  onAutoListenUsed?(): void;
}) {
  const { i18n, prefs, api, openSos, onInterrupt, providers } = useApp();
  const { t } = i18n;
  const voice = useVoice();

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DictKey | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const pendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Emergency help and navigation cancel the request in flight.
  useEffect(() => onInterrupt(() => abortRef.current?.abort()), [onInterrupt]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Follow the conversation, but leave an empty chat at the top so its title stays visible.
  useEffect(() => {
    if (messages.length > 0) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  const newId = () => `m${(nextId.current += 1)}-${messages.length}`;

  const play = async (item: ChatItem) => {
    setSpeakingId(item.id);
    await voice.speak(item.text, item.language);
    setSpeakingId((current) => (current === item.id ? null : current));
  };

  const request = async (history: ChatItem[], mode: 'text' | 'voice') => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await api.chat(
        { messages: boundHistory(history), locale: i18n.selected, inputMode: mode },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const reply: ChatItem = {
        id: newId(),
        role: 'assistant',
        text: response.reply.text,
        language: response.reply.language,
        sources: response.sources,
        urgent: response.safety.urgent,
      };
      setMessages((previous) => [...previous, reply]);
      // A spoken question gets a spoken answer; typed questions are read only if the user asked for that.
      if (prefs.autoRead || mode === 'voice') void play(reply);
    } catch (caught) {
      const code = caught instanceof ApiClientError ? caught.code : 'internal_error';
      if (code !== 'aborted') setError(errorMessage(code));
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const send = (text: string, mode: 'text' | 'voice') => {
    const trimmed = text.trim().slice(0, LIMITS.chatMessageChars);
    if (!trimmed || pendingRef.current) return;
    const item: ChatItem = {
      id: newId(),
      role: 'user',
      text: trimmed,
      language: i18n.selected,
      sources: [],
      urgent: false,
    };
    const history = [...messages, item];
    setMessages(history);
    setDraft('');
    void request(history, mode);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(draft, 'text');
  };

  const startNew = () => {
    abortRef.current?.abort();
    voice.stop();
    setMessages([]);
    setError(null);
    setDraft('');
  };

  const startListening = () => voice.listen(i18n.selected, (transcript) => send(transcript, 'voice'));

  // Opened from the home talk button: listen straight away, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoListen || autoStarted.current) return;
    autoStarted.current = true;
    onAutoListenUsed?.();
    startListening();
    // Runs once on arrival; later renders must not restart the microphone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen]);

  const last = messages[messages.length - 1];
  const awaitingReply = !pending && last?.role === 'user';

  return (
    <section aria-labelledby="chat-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="chat-title" className="text-3xl font-bold tracking-tight">
          {t('chatTitle')}
        </h1>
        {messages.length > 0 && (
          <Button variant="quiet" size="md" icon="refresh" onClick={startNew}>
            {t('chatNew')}
          </Button>
        )}
      </div>

      {providers === 'mock' && (
        <Notice tone="warning" live={false}>
          {t('chatMockNotice')}
        </Notice>
      )}

      <p className="text-base text-muted">{t('chatDisclaimer')}</p>

      <div role="log" aria-live="polite" aria-label={t('chatTitle')} className="flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3 rounded-3xl border border-line-soft bg-card p-4 shadow-card">
              <BrandMark size={40} />
              <p className="min-w-0 flex-1">{t('chatEmpty')}</p>
            </div>
            <p className="font-semibold text-muted">{t('chatTry')}</p>
            <ul className="flex flex-col gap-2">
              {SUGGESTIONS.map((key) => (
                <li key={key}>
                  <Button variant="secondary" size="md" block align="start" icon="sparkle" disabled={pending} onClick={() => send(t(key), 'text')}>
                    {t(key)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((message) => {
          const language = LANGUAGES[message.language];
          const mine = message.role === 'user';
          return (
            <article
              key={message.id}
              className={`rounded-3xl p-4 shadow-card ${
                mine
                  ? 'ms-8 rounded-ee-lg bg-primary text-white'
                  : 'me-8 rounded-es-lg border border-line-soft bg-card'
              }`}
            >
              <h2 className={`mb-1 flex items-center gap-2 text-base font-bold ${mine ? '' : 'text-muted'}`}>
                {!mine && <BrandMark size={28} />}
                {mine ? t('chatYou') : t('appName')}
              </h2>
              {/* The message may be in a different language and direction from the interface. */}
              <div lang={language.bcp47} dir={language.dir} className="break-words">
                <SafeText text={message.text} />
              </div>
              {!mine && message.urgent && (
                <div className="mt-3 flex flex-col gap-3">
                  <Notice tone="danger" live={false}>
                    {t('chatUrgent')}
                  </Notice>
                  <Button variant="danger" icon="phone" onClick={openSos}>
                    {t('getHelp')}
                  </Button>
                </div>
              )}
              {!mine && message.sources.length > 0 && (
                <div className="mt-3">
                  <h3 className="font-semibold">{t('chatSources')}</h3>
                  <ul className="list-disc ps-6">
                    {message.sources.map((source) => (
                      <li key={source.id}>
                        <a className="text-primary underline" href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.title}
                        </a>
                        <span className="text-muted"> ({source.publisher})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!mine && (
                <div className="mt-3">
                  {speakingId === message.id && voice.status === 'speaking' ? (
                    <Button variant="secondary" size="md" icon="stop" onClick={voice.stop}>
                      {t('stop')}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="md" icon="speaker" onClick={() => void play(message)}>
                      {t('listen')}
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {pending && (
          <p className="me-8 flex items-center gap-2 rounded-3xl rounded-es-lg border border-line-soft bg-card p-4 font-semibold shadow-card">
            <BrandMark size={28} />
            {t('chatThinking')}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {error && <Notice tone="danger">{t(error)}</Notice>}
      {awaitingReply && (
        <Button variant="secondary" icon="refresh" onClick={() => void request(messages, 'text')}>
          {t('retry')}
        </Button>
      )}
      {voice.notice && <Notice tone="warning">{t(voice.notice)}</Notice>}
      {voice.status === 'listening' && (
        <Notice tone="info" icon="mic">
          <p className="font-semibold">{t('micListening')}</p>
          {voice.showMicExplanation && <p>{t('micPermissionExplain')}</p>}
        </Notice>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-3xl border border-line-soft bg-card p-4 shadow-card">
        <label htmlFor="chat-input" className="font-semibold">
          {t('chatInputLabel')}
        </label>
        <textarea
          id="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={LIMITS.chatMessageChars}
          rows={2}
          placeholder={t('chatPlaceholder')}
          className="w-full rounded-2xl border-2 border-line bg-surface p-4 text-lg placeholder:text-muted"
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
              onClick={startListening}
            >
              {t('speak')}
            </Button>
          )}
          <Button type="submit" icon="send" disabled={pending || draft.trim().length === 0}>
            {t('send')}
          </Button>
        </div>
      </form>
    </section>
  );
}
