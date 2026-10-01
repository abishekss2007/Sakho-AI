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
  /** The speech service is over its limit for now and no device voice exists. Nothing was spoken. */
  | 'busy'
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
  name?: string;
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
  /** 1 is normal speed. Used to apply the user's speaking-speed setting. */
  playbackRate: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

/** Audio that arrives while it is being generated: raw 16-bit mono PCM. */
export interface TtsStream {
  sampleRate: number;
  chunks: AsyncIterable<Uint8Array>;
}

/** Plays PCM chunks back to back as they arrive. */
export interface PcmPlayerLike {
  /** Resolves false when the browser refuses to start audio without a tap. */
  ready(): Promise<boolean>;
  enqueue(chunk: Uint8Array): void;
  /** No more chunks will come; `onended` fires once everything queued has played. */
  finish(): void;
  stop(): void;
  onended: (() => void) | null;
}

/** Everything the controller needs from the platform, injectable for tests. */
export interface SpeechEnv {
  recognitionCtor(): (new () => RecognitionLike) | undefined;
  synth(): SynthLike | undefined;
  createUtterance(text: string): UtteranceLike;
  /**
   * Resolves with a complete clip, or with a stream when the server relays
   * audio as it is generated. Rejects on any failure including abort.
   */
  fetchTts(body: TtsRequest, signal: AbortSignal): Promise<Blob | TtsStream>;
  // A rejection whose `name` is `TTS_BUSY` means the service is temporarily over its limit.
  /** Whether this browser can play audio that arrives in pieces. */
  streamingSupported(): boolean;
  createPcmPlayer(sampleRate: number): PcmPlayerLike | undefined;
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
  /**
   * `device`: use the device's own voice when it has one for the language
   * (instant, free, works offline) and the speech service otherwise.
   * `cloud` (default): the speech service first, the device voice as fallback.
   */
  prefer?: 'device' | 'cloud';
}

/** Browsers cut off long utterances, so device speech is queued sentence by sentence. */
const DEVICE_PIECE_CHARS = 180;

export function splitSentences(text: string, maxChars = DEVICE_PIECE_CHARS): string[] {
  const sentences = text.trim().split(/(?<=[.!?।۔])\s+|\n+/).filter(Boolean);
  const pieces: string[] = [];
  for (const sentence of sentences) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + sentence.length + 1 <= maxChars) pieces[pieces.length - 1] = `${last} ${sentence}`;
    else pieces.push(sentence);
  }
  return pieces.length > 0 ? pieces : [text.trim()];
}

/** `name` of the error `fetchTts` rejects with when the speech service is over its limit. */
export const TTS_BUSY = 'TtsBusy';

/** How many fetched clips are kept for replay during one visit. Memory only. */
const AUDIO_CACHE_LIMIT = 40;

/** Common names of female system voices, used only to choose among device voices. */
const FEMALE_VOICE = /female|woman|google|heera|swara|kalpana|lekha|veena|aditi|raveena|priya|sangeeta|shruti|neerja|pallavi|zira|samantha|susan|hazel/i;

const RATE = { slow: 0.8, normal: 1, fast: 1.2 } as const;

/** A WAV file from PCM chunks, so streamed audio can be replayed later like any other clip. */
export function wavFromPcm(chunks: readonly Uint8Array[], sampleRate: number): Blob {
  const size = chunks.reduce((n, c) => n + c.byteLength, 0);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => header.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + size, true);
  ascii(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, 'data');
  header.setUint32(40, size, true);
  return new Blob([header.buffer, ...chunks.map((c) => c.slice().buffer)], { type: 'audio/wav' });
}

/**
 * Split a long reply into an opening sentence and the rest. Both are fetched
 * at once and played in order, so sound starts after the short first part
 * instead of after the whole reply has been synthesised.
 */
export function splitForSpeech(text: string): string[] {
  const clean = text.trim();
  if (clean.length < 140) return [clean];
  const sentences = clean.split(/(?<=[.!?।۔])\s+|\n+/).filter(Boolean);
  let first = '';
  let index = 0;
  while (index < sentences.length && first.length < 60) {
    first = `${first} ${sentences[index] ?? ''}`.trim();
    index += 1;
  }
  const rest = sentences.slice(index).join(' ').trim();
  return first && rest.length >= 40 ? [first, rest] : [clean];
}
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
  private pcm: PcmPlayerLike | undefined;
  /** Audio already fetched in this visit, so "Listen again" costs no new request. */
  private readonly clips = new Map<string, Blob>();

  constructor(private readonly env: SpeechEnv) {
    // Some browsers only load their voice list after it is first asked for.
    try {
      this.env.synth()?.getVoices();
    } catch {
      // Speech synthesis unavailable; cloud speech and text still work.
    }
  }

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
    const { bcp47, prefer = 'cloud', ...ttsRequest } = options;

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

      /** Set when the speech service said it is over its limit, to explain the silence accurately. */
      let busy = false;
      const noteFailure = (error: unknown) => {
        if ((error as { name?: string } | null)?.name === TTS_BUSY) busy = true;
      };

      /** Speak with a device voice, one sentence at a time. `onFail` runs if nothing could be spoken. */
      const utter = (synth: SynthLike, voice: VoiceLike, text: string, onFail: () => void) => {
        const pieces = splitSentences(text);
        let next = 0;
        const speakNext = () => {
          if (!current()) return;
          const piece = pieces[next];
          if (piece === undefined) return settle('played_device_voice');
          const first = next === 0;
          next += 1;
          const utterance = this.env.createUtterance(piece);
          utterance.lang = bcp47;
          utterance.voice = voice;
          utterance.rate = RATE[ttsRequest.speed];
          utterance.onend = speakNext;
          utterance.onerror = () => {
            if (!current()) return;
            // Only a failure before any sound is worth retrying another way.
            if (first) onFail();
            else settle('failed');
          };
          try {
            synth.speak(utterance);
          } catch {
            if (first) onFail();
            else settle('failed');
          }
        };
        speakNext();
      };

      /** Last resort after the speech service failed. */
      const deviceVoice = async (text: string) => {
        const synth = this.env.synth();
        if (!synth) return settle(busy ? 'busy' : 'failed');
        const voice = await this.findVoice(synth, bcp47);
        if (!current()) return;
        // Speaking with a voice for another language would be unintelligible, so say nothing.
        if (!voice) return settle(busy ? 'busy' : 'no_voice');
        utter(synth, voice, text, () => settle('failed'));
      };

      this.cancelSpeak = () => settle('cancelled');
      this.setStatus('speaking');

      const cloud = () => {
        const abort = new AbortController();
        this.ttsAbort = abort;

        // At normal speed the reply is streamed in one request and starts playing within about a second.
        // Other speeds need a complete clip (the player changes speed without changing pitch), so a long
        // reply is fetched as an opening sentence plus the rest, in parallel.
        const streaming = ttsRequest.speed === 'normal' && this.env.streamingSupported();
        const parts = streaming ? [ttsRequest.text.trim()] : splitForSpeech(ttsRequest.text);
        const clips = parts.map((text) => this.fetchClip({ ...ttsRequest, text }, abort.signal, streaming));
        clips.forEach((clip) => clip.catch(() => undefined));

        const playStream = (stream: TtsStream, index: number, clipKey: string, remaining: () => string) => {
          const player = this.env.createPcmPlayer(stream.sampleRate);
          if (!player) return void deviceVoice(remaining());
          this.pcm = player;
          player.onended = () => {
            if (current()) playPart(index + 1);
          };
          const received: Uint8Array[] = [];
          void (async () => {
            try {
              if (!(await player.ready())) {
                if (current()) settle('blocked');
                return;
              }
              for await (const chunk of stream.chunks) {
                if (!current()) return;
                received.push(chunk);
                player.enqueue(chunk);
              }
              if (!current()) return;
              // Keep the finished clip so "Listen again" is instant and needs no request.
              this.rememberClip(clipKey, wavFromPcm(received, stream.sampleRate));
              player.finish();
            } catch {
              if (!current()) return;
              // Nothing was heard yet: fall back. Otherwise let what arrived finish playing.
              if (received.length === 0) {
                this.releaseAudio();
                void deviceVoice(remaining());
              } else player.finish();
            }
          })();
        };

        const playPart = (index: number) => {
          const clip = clips[index];
          const text = parts[index];
          if (!clip || text === undefined) return settle('played');
          const remaining = () => parts.slice(index).join(' ');
          clip
            .then((result) => {
              if (!current()) return;
              this.releaseAudio();
              if (!(result instanceof Blob)) return playStream(result, index, this.clipKey(ttsRequest.locale, text), remaining);
              const url = this.env.createObjectURL(result);
              const element = this.env.createAudio(url);
              element.playbackRate = RATE[ttsRequest.speed];
              this.audio = { element, url };
              element.onended = () => {
                if (current()) playPart(index + 1);
              };
              element.onerror = () => {
                if (!current()) return;
                this.releaseAudio();
                void deviceVoice(remaining());
              };
              element.play().catch((error: unknown) => {
                if (!current()) return;
                if ((error as { name?: string } | null)?.name === 'NotAllowedError') settle('blocked');
                else {
                  this.releaseAudio();
                  void deviceVoice(remaining());
                }
              });
            })
            .catch((error: unknown) => {
              noteFailure(error);
              if (current()) void deviceVoice(remaining());
            });
        };
        playPart(0);
      };

      if (prefer === 'device') {
        // A voice already on the device answers at once and needs no request.
        const synth = this.env.synth();
        const voice = synth ? this.pickVoice(synth, bcp47) : undefined;
        if (synth && voice) utter(synth, voice, ttsRequest.text, cloud);
        else cloud();
      } else cloud();
    });
  }

  private clipKey(locale: string, text: string): string {
    // Speed is applied by the player, so one clip serves every speed.
    return `${locale}|${text}`;
  }

  private rememberClip(key: string, blob: Blob): void {
    if (this.clips.size >= AUDIO_CACHE_LIMIT) {
      const oldest = this.clips.keys().next().value;
      if (oldest !== undefined) this.clips.delete(oldest);
    }
    this.clips.set(key, blob);
  }

  /** Audio for one piece of text: from this visit's memory, or fetched (and remembered when complete). */
  private fetchClip(request: TtsRequest, signal: AbortSignal, stream: boolean): Promise<Blob | TtsStream> {
    const key = this.clipKey(request.locale, request.text);
    const stored = this.clips.get(key);
    if (stored) return Promise.resolve(stored);
    return this.env.fetchTts(stream ? { ...request, stream: true } : request, signal).then((result) => {
      if (result instanceof Blob) this.rememberClip(key, result);
      return result;
    });
  }

  /** A voice on the device for this language right now, preferring a female one. No waiting. */
  private pickVoice(synth: SynthLike, bcp47: string): VoiceLike | undefined {
    const prefix = (bcp47.split('-')[0] ?? bcp47).toLowerCase();
    const matching = synth.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().split('-')[0] === prefix);
    return matching.find((v) => FEMALE_VOICE.test(v.name ?? '')) ?? matching[0];
  }

  private async findVoice(synth: SynthLike, bcp47: string): Promise<VoiceLike | undefined> {
    const pick = () => this.pickVoice(synth, bcp47);
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
    const pcm = this.pcm;
    if (pcm) {
      this.pcm = undefined;
      pcm.onended = null;
      try {
        pcm.stop();
      } catch {
        // Already stopped.
      }
    }
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

  /** Forget fetched audio, for example when the user erases the session. */
  clearClips(): void {
    this.clips.clear();
  }

  /** Stop everything at once. Used when emergency help opens, on navigation and on language change. */
  stopAll(): void {
    this.stopListening();
    this.stopSpeaking();
  }
}
