'use client';

import { useCallback, useState } from 'react';
import { LIMITS } from '@/lib/api/contracts';
import type { DictKey } from '@/lib/i18n';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';
import type { ListenError, SpeakOutcome } from '@/lib/speech/controller';
import { useSpeech } from '@/lib/speech/useSpeech';
import { useApp } from './AppContext';

const LISTEN_MESSAGES: Record<ListenError, DictKey> = {
  unsupported: 'micUnsupported',
  denied: 'micDenied',
  no_speech: 'micNoSpeech',
  network: 'micNetwork',
  failed: 'micFailed',
};

const SPEAK_MESSAGES: Partial<Record<SpeakOutcome, DictKey>> = {
  no_voice: 'ttsNoVoice',
  busy: 'ttsBusy',
  failed: 'ttsFailed',
  blocked: 'ttsBlocked',
};

/**
 * Screen-level access to the shared speech controller, translating its
 * outcomes into messages. Voice problems never block typing or buttons: they
 * only ever produce a notice.
 */
export function useVoice() {
  const { prefs, speechPreference } = useApp();
  const { controller, status } = useSpeech();
  const [notice, setNotice] = useState<DictKey | null>(null);
  const [explained, setExplained] = useState(false);

  const speak = useCallback(
    async (text: string, locale: LanguageCode, shared = false): Promise<SpeakOutcome> => {
      setNotice(null);
      const outcome = await controller.speak({
        text: text.slice(0, LIMITS.ttsChars),
        ...(shared ? { shared: true } : {}),
        locale,
        bcp47: LANGUAGES[locale].bcp47,
        speed: prefs.speed,
        prefer: speechPreference,
      });
      const message = SPEAK_MESSAGES[outcome];
      if (message) setNotice(message);
      return outcome;
    },
    [controller, prefs.speed, speechPreference],
  );

  const listen = useCallback(
    (locale: LanguageCode, onResult: (transcript: string) => void) => {
      setNotice(null);
      // The microphone is explained the first time it is actually used.
      setExplained(true);
      controller.listen({
        bcp47: LANGUAGES[locale].bcp47,
        onResult,
        onError: (error) => setNotice(LISTEN_MESSAGES[error]),
      });
    },
    [controller],
  );

  const stop = useCallback(() => controller.stopAll(), [controller]);

  return { status, speak, listen, stop, notice, showMicExplanation: explained && status === 'listening' };
}
