'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createPcmPlayer, pcmStreamingSupported } from './pcmPlayer';
import { SpeechController, TTS_BUSY, type AudioLike, type RecognitionLike, type SpeechEnv, type SynthLike, type UtteranceLike } from './controller';

type RecognitionWindow = {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

/** Real browser bindings. Every accessor tolerates the API being absent. */
export function browserSpeechEnv(): SpeechEnv {
  return {
    recognitionCtor: () => {
      if (typeof window === 'undefined') return undefined;
      const w = window as unknown as RecognitionWindow;
      return w.SpeechRecognition ?? w.webkitSpeechRecognition;
    },
    synth: () =>
      typeof window !== 'undefined' && 'speechSynthesis' in window
        ? (window.speechSynthesis as unknown as SynthLike)
        : undefined,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    fetchTts: async (body, signal) => {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const failure = new Error('tts_unavailable');
        const code = await response
          .json()
          .then((json: { error?: { code?: string } }) => json.error?.code)
          .catch(() => undefined);
        if (code === 'provider_rate_limited' || code === 'rate_limited' || code === 'budget_exhausted') failure.name = TTS_BUSY;
        throw failure;
      }
      const type = response.headers.get('content-type') ?? '';
      const payload = response.body;
      if (/audio\/l16/i.test(type) && payload) {
        // Raw PCM relayed while it is being generated.
        const reader = payload.getReader();
        async function* chunks() {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
        return { sampleRate: Number(/rate=(\d+)/.exec(type)?.[1]) || 24_000, chunks: chunks() };
      }
      return response.blob();
    },
    streamingSupported: pcmStreamingSupported,
    createPcmPlayer,
    createAudio: (url) => new Audio(url) as unknown as AudioLike,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

const SpeechContext = createContext<SpeechController | null>(null);

export function SpeechProvider({ controller, children }: { controller?: SpeechController; children: ReactNode }) {
  const value = useMemo(() => controller ?? new SpeechController(browserSpeechEnv()), [controller]);
  useEffect(() => () => value.stopAll(), [value]);
  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): { controller: SpeechController; status: ReturnType<SpeechController['getStatus']> } {
  const controller = useContext(SpeechContext);
  if (!controller) throw new Error('useSpeech must be used inside SpeechProvider');
  const status = useSyncExternalStore(controller.subscribe, controller.getStatus, () => 'idle' as const);
  return { controller, status };
}
