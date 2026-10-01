'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api as defaultApi, type Api } from '@/lib/client/api';
import type { SosMode } from '@/lib/emergency';
import { createI18n } from '@/lib/i18n';
import { DEFAULT_LANGUAGE, type LanguageCode } from '@/lib/languages';
import type { SpeechController } from '@/lib/speech/controller';
import { SpeechProvider, useSpeech } from '@/lib/speech/useSpeech';
import { loadPrefs, savePrefs, type Prefs } from '@/lib/storage';
import { AppContext, type AppServices } from './AppContext';
import { BenefitsFlow } from './BenefitsFlow';
import { ChatScreen } from './ChatScreen';
import { HomeScreen, SettingsScreen } from './HomeAndSettings';
import { IntroModal } from './IntroModal';
import { LanguageScreen } from './LanguageScreen';
import { SosDialog } from './SosDialog';
import { EMPTY_BENEFITS, type BenefitsState, type ChatItem, type Screen } from './types';
import { Button } from './ui/Button';
import { BrandMark, Icon, type IconName } from './ui/Icon';
import { Notice } from './ui/Notice';

export interface AppProps {
  sosMode: SosMode;
  providers: 'live' | 'mock';
  /** Which voice is tried first. Defaults to the device's own voice. */
  speechPreference?: 'device' | 'cloud';
  /** Injected in tests. */
  api?: Api;
  speech?: SpeechController;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

const NAV: readonly { screen: Screen; icon: IconName; label: 'navHome' | 'navChat' | 'navBenefits' | 'navSettings' }[] = [
  { screen: 'home', icon: 'home', label: 'navHome' },
  { screen: 'chat', icon: 'chat', label: 'navChat' },
  { screen: 'benefits', icon: 'benefits', label: 'navBenefits' },
  { screen: 'settings', icon: 'settings', label: 'navSettings' },
];

export function App(props: AppProps) {
  return (
    <SpeechProvider controller={props.speech}>
      <Shell {...props} />
    </SpeechProvider>
  );
}

function Shell({ sosMode, providers, speechPreference = 'device', api = defaultApi }: AppProps) {
  const { controller: speech } = useSpeech();

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [screen, setScreen] = useState<Screen>(() => (prefs.language ? 'home' : 'language'));
  const [introOpen, setIntroOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  /** Set when the home talk button was pressed: the chat screen starts listening once. */
  const [autoListen, setAutoListen] = useState(false);
  // Sensitive content: held in memory only, never written to storage.
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [benefits, setBenefits] = useState<BenefitsState>(EMPTY_BENEFITS);

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const selected: LanguageCode = prefs.language ?? DEFAULT_LANGUAGE;
  const i18n = useMemo(() => createI18n(selected), [selected]);

  // The page language is whatever the interface text is actually written in.
  useEffect(() => {
    document.documentElement.lang = i18n.uiLanguage;
    document.documentElement.dir = i18n.uiDir;
  }, [i18n]);

  // Each screen starts at the top; otherwise a long previous screen leaves the new one scrolled.
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [screen]);

  const interrupts = useRef(new Set<() => void>());
  const onInterrupt = useCallback((cancel: () => void) => {
    interrupts.current.add(cancel);
    return () => {
      interrupts.current.delete(cancel);
    };
  }, []);

  /** Stop the microphone, any speech, and pending non-essential requests. */
  const interruptAll = useCallback(() => {
    speech.stopAll();
    interrupts.current.forEach((cancel) => cancel());
  }, [speech]);

  const openSos = useCallback(() => {
    interruptAll();
    setSosOpen(true);
  }, [interruptAll]);

  const go = useCallback(
    (next: Screen) => {
      interruptAll();
      setScreen(next);
    },
    [interruptAll],
  );

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    // Only non-sensitive preferences are stored; a blocked store is not an error.
    savePrefs(next);
  };

  const confirmLanguage = (language: LanguageCode) => {
    // Old-language recognition and speech must not carry over.
    interruptAll();
    updatePrefs({ language });
    // Progress in chat and the questionnaire is kept across a language change.
    setScreen('home');
    if (!prefs.introSeen) setIntroOpen(true);
  };

  const closeIntro = () => {
    setIntroOpen(false);
    updatePrefs({ introSeen: true });
  };

  const clearSession = () => {
    interruptAll();
    speech.clearClips();
    setMessages([]);
    setBenefits(EMPTY_BENEFITS);
  };

  const services: AppServices = useMemo(
    () => ({ i18n, prefs, api, online, sosMode, providers, speechPreference, openSos, onInterrupt }),
    [i18n, prefs, api, online, sosMode, providers, speechPreference, openSos, onInterrupt],
  );
  const { t } = i18n;
  const languageChosen = prefs.language !== null;

  return (
    <AppContext.Provider value={services}>
      <div inert={introOpen || sosOpen} className="mx-auto flex h-dvh max-w-xl flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-card focus:p-3"
        >
          {t('skipToContent')}
        </a>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <p className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <BrandMark size={36} />
            {t('appName')}
          </p>
          {/* Emergency help: always present, labelled with text and an icon, not colour alone. */}
          <Button variant="danger" size="md" icon="phone" className="min-h-[48px]! rounded-full py-2" onClick={openSos}>
            {t('getHelp')}
          </Button>
        </header>

        {!online && (
          <div className="shrink-0 px-4 pt-1">
            <Notice tone="warning">{t('offlineBanner')}</Notice>
          </div>
        )}

        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6 outline-none">
          {screen === 'language' && <LanguageScreen current={selected} onConfirm={confirmLanguage} />}
          {screen === 'home' && (
            <HomeScreen
              go={go}
              onTalk={() => {
                setAutoListen(true);
                go('chat');
              }}
              onPapers={() => {
                setBenefits((b) => ({ ...b, stage: 'documents' }));
                go('benefits');
              }}
            />
          )}
          {screen === 'chat' && (
            <ChatScreen
              messages={messages}
              setMessages={setMessages}
              autoListen={autoListen}
              onAutoListenUsed={() => setAutoListen(false)}
            />
          )}
          {screen === 'benefits' && <BenefitsFlow state={benefits} setState={setBenefits} />}
          {screen === 'settings' && (
            <SettingsScreen
              onPrefs={updatePrefs}
              onChangeLanguage={() => go('language')}
              onClear={clearSession}
              onShowIntro={() => setIntroOpen(true)}
            />
          )}
        </main>

        {languageChosen && (
          <nav
            aria-label={t('navLabel')}
            className="shrink-0 px-3 pt-1 pb-3"
          >
            <ul className="grid grid-cols-4 gap-1 rounded-3xl border border-line-soft bg-card p-1.5 shadow-float">
              {NAV.map((item) => {
                const current = screen === item.screen;
                return (
                  <li key={item.screen}>
                    <button
                      type="button"
                      aria-current={current ? 'page' : undefined}
                      onClick={() => go(item.screen)}
                      className={`flex min-h-[min(4rem,64px)] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-1.5 text-[0.82rem] leading-tight font-bold transition wrap-anywhere ${
                        current ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-primary-soft'
                      }`}
                    >
                      <Icon name={item.icon} size={26} />
                      <span>{t(item.label)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>

      {introOpen && <IntroModal onDone={closeIntro} inert={sosOpen} />}
      {sosOpen && <SosDialog onClose={() => setSosOpen(false)} />}
    </AppContext.Provider>
  );
}
