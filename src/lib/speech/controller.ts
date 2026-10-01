import type { TtsRequest } from '@/lib/api/contracts';

/**
 * One coordinated controller for speech input and output.
 *
 * Browser recognition, cloud audio and browser synthesis share a single
 * lifecycle here: starting one stops the others, every callback is tied to a
 * session number so late callbacks are ignored, and audio resources are
 * released on every exit path.
 */

export type SpeechStatus = 'idle' | 'listening' | 'speaking';
export type ListenError = 'unsupported' | 'denied' | 'no_speech' | 'network' | 'failed';
export type SpeakOutcome =
  | 'played'
  /** Cloud audio failed and a matching voice on the device was used instead. */
  | 'played_device_voice'
  /** The browser refused to start audio without a tap. */
  | 'blocked'
  /** No cloud audio and no device voice for this language. Nothing was spoken. */
  | 'no_voice'
  | 'failed'
  | 'cancelled';

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

export interface VoiceLike {
  lang: string;
}

export interface UtteranceLike {
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  addEventListener(type: 'voiceschanged', listener: () => void): void;
  removeEventListener(type: 'voiceschanged', listener: () => void): void;
}

export interface AudioLike {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

/** Everything the controller needs from the platform, injectable for tests. */
export interface SpeechEnv {
  recognitionCtor(): (new () => RecognitionLike) | undefined;
  synth(): SynthLike | undefined;
  createUtterance(text: string): UtteranceLike;
  /** Resolves with audio, rejects on any failure including abort. */
  fetchTts(body: TtsRequest, signal: AbortSignal): Promise<Blob>;
  createAudio(url: string): AudioLike;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface ListenOptions {
  bcp47: string;
  onResult(transcript: string): void;
  onError(error: ListenError): void;
}

export interface SpeakOptions extends TtsRequest {
  bcp47: string;
}

const RATE = { slow: 0.8, normal: 1, fast: 1.2 } as const;
const VOICE_WAIT_MS = 700;

function mapRecognitionError(error: string): ListenError {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
      return 'no_speech';
    case 'network':
      return 'network';
    case 'language-not-supported':
      return 'unsupported';
    default:
      return 'failed';
  }
}

export class SpeechController {
  private status: SpeechStatus = 'idle';
  private readonly subscribers = new Set<() => void>();

  private listenSession = 0;
  private recognition: RecognitionLike | undefined;

  private speakSession = 0;
  private cancelSpeak: (() => void) | undefined;
  private ttsAbort: AbortController | undefined;
  private audio: { element: AudioLike; url: string } | undefined;

  constructor(private readonly env: SpeechEnv) {}

  getStatus = (): SpeechStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  private setStatus(status: SpeechStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.subscribers.forEach((l) => l());
  }

  recognitionSupported(): boolean {
    return this.env.recognitionCtor() !== undefined;
  }

  // ---- Listening ----------------------------------------------------------

  listen(options: ListenOptions): void {
    this.stopSpeaking();
    this.stopListening();

    const Ctor = this.env.recognitionCtor();
    if (!Ctor) {
      options.onError('unsupported');
      return;
    }

    const session = ++this.listenSession;
    let settled = false;
    // Runs `then` once, and only if this is still the current session.
    const finish = (then: () => void) => {
      if (settled || session !== this.listenSession) return;
      settled = true;
      this.detachRecognition();
      this.setStatus('idle');
      then();
    };

    let recognition: RecognitionLike;
    try {
      recognition = new Ctor();
      recognition.lang = options.bcp47;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
    } catch {
      options.onError('failed');
      return;
    }

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript.trim();
      finish(() => (transcript ? options.onResult(transcript) : options.onError('no_speech')));
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') finish(() => undefined);
      else finish(() => options.onError(mapRecognitionError(event.error)));
    };
    // `end` without a result or error means nothing was heard.
    recognition.onend = () => finish(() => options.onError('no_speech'));

    this.recognition = recognition;
    this.setStatus('listening');
    try {
      recognition.start();
    } catch {
      // start() throws synchronously if recognition is already running or blocked.
      finish(() => options.onError('failed'));
    }
  }

  private detachRecognition(): void {
    const recognition = this.recognition;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    this.recognition = undefined;
  }

  /** Stop recognition; callbacks from the stopped session are ignored. */
  stopListening(): void {
    this.listenSession += 1;
    const recognition = this.recognition;
    this.detachRecognition();
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    }
    if (this.status === 'listening') this.setStatus('idle');
  }

  // ---- Speaking -----------------------------------------------------------

  speak(options: SpeakOptions): Promise<SpeakOutcome> {
    this.stopListening();
    this.stopSpeaking();

    const session = ++this.speakSession;
    const { bcp47, ...ttsRequest } = options;

    return new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      const current = () => !settled && session === this.speakSession;
      const settle = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        if (session === this.speakSession) {
          this.releaseAudio();
          this.cancelSpeak = undefined;
          this.ttsAbort = undefined;
          this.setStatus('idle');
        }
        resolve(outcome);
      };

      const deviceVoice = async () => {
        const synth = this.env.synth();
        if (!synth) return settle('failed');
        const voice = await this.findVoice(synth, bcp47);
        if (!current()) return;
        // Speaking with a voice for another language would be unintelligible, so say nothing.
        if (!voice) return settle('no_voice');
        const utterance = this.env.createUtterance(ttsRequest.text);
        utterance.lang = bcp47;
        utterance.voice = voice;
        utterance.rate = RATE[ttsRequest.speed];
        utterance.onend = () => settle('played_device_voice');
        utterance.onerror = () => settle('failed');
        try {
          synth.speak(utterance);
        } catch {
          settle('failed');
        }
      };

      this.cancelSpeak = () => settle('cancelled');
      this.setStatus('speaking');

      const abort = new AbortController();
      this.ttsAbort = abort;
      this.env
        .fetchTts(ttsRequest, abort.signal)
        .then((blob) => {
          if (!current()) return;
          const url = this.env.createObjectURL(blob);
          const element = this.env.createAudio(url);
          this.audio = { element, url };
          element.onended = () => settle('played');
          element.onerror = () => {
            if (!current()) return;
            this.releaseAudio();
            void deviceVoice();
          };
          element.play().catch((error: unknown) => {
            if (!current()) return;
            if ((error as { name?: string } | null)?.name === 'NotAllowedError') settle('blocked');
            else {
              this.releaseAudio();
              void deviceVoice();
            }
          });
        })
        .catch(() => {
          if (current()) void deviceVoice();
        });
    });
  }

  private async findVoice(synth: SynthLike, bcp47: string): Promise<VoiceLike | undefined> {
    const prefix = (bcp47.split('-')[0] ?? bcp47).toLowerCase();
    const pick = () =>
      synth.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().split('-')[0] === prefix);
    const immediate = pick();
    if (immediate || synth.getVoices().length > 0) return immediate;
    // Some browsers load the voice list asynchronously.
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', done);
        resolve(pick());
      };
      const timer = setTimeout(done, VOICE_WAIT_MS);
      synth.addEventListener('voiceschanged', done);
    });
  }

  private releaseAudio(): void {
    const audio = this.audio;
    if (!audio) return;
    this.audio = undefined;
    audio.element.onended = null;
    audio.element.onerror = null;
    try {
      audio.element.pause();
    } catch {
      // Nothing to pause.
    }
    this.env.revokeObjectURL(audio.url);
  }

  stopSpeaking(): void {
    this.ttsAbort?.abort();
    this.ttsAbort = undefined;
    // Resolves the pending speak() as cancelled and releases its audio.
    this.cancelSpeak?.();
    this.cancelSpeak = undefined;
    this.speakSession += 1;
    this.releaseAudio();
    try {
      this.env.synth()?.cancel();
    } catch {
      // Synthesis unavailable.
    }
    if (this.status === 'speaking') this.setStatus('idle');
  }

  /** Stop everything at once. Used when emergency help opens, on navigation and on language change. */
  stopAll(): void {
    this.stopListening();
    this.stopSpeaking();
  }
}
