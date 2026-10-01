import { vi } from 'vitest';
import type { Api } from '@/lib/client/api';
import { evaluate } from '@/lib/scheme/engine';
import {
  SpeechController,
  type AudioLike,
  type PcmPlayerLike,
  type TtsStream,
  type RecognitionLike,
  type SpeechEnv,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from '@/lib/speech/controller';

/** Scriptable stand-in for the browser's SpeechRecognition. */
export class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false;
  aborted = false;
  start(): void {
    this.started = true;
  }
  abort(): void {
    this.aborted = true;
  }
  say(transcript: string): void {
    this.onresult?.({ results: [[{ transcript }]] });
  }
  fail(error: string): void {
    this.onerror?.({ error });
  }
  end(): void {
    this.onend?.();
  }
}

export class FakeAudio implements AudioLike {
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  playResult: () => Promise<void> = () => Promise.resolve();
  constructor(public readonly url: string) {}
  play(): Promise<void> {
    return this.playResult();
  }
  pause(): void {
    this.paused = true;
  }
}

export class FakePcmPlayer implements PcmPlayerLike {
  onended: (() => void) | null = null;
  chunks: Uint8Array[] = [];
  finished = false;
  stopped = false;
  allowed = true;
  constructor(public readonly sampleRate: number) {}
  ready(): Promise<boolean> {
    return Promise.resolve(this.allowed);
  }
  enqueue(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }
  finish(): void {
    this.finished = true;
  }
  stop(): void {
    this.stopped = true;
  }
  /** The queued audio has finished playing. */
  end(): void {
    this.onended?.();
  }
}

export interface FakeSpeech {
  env: SpeechEnv;
  controller: SpeechController;
  recognitions: FakeRecognition[];
  audios: FakeAudio[];
  revoked: string[];
  utterances: UtteranceLike[];
  ttsRequests: { text: string; locale: string; speed: string; stream?: boolean; signal: AbortSignal }[];
  players: FakePcmPlayer[];
  /** Mutable switches for a test to flip. */
  options: {
    recognition: boolean;
    startThrows: boolean;
    tts: 'ok' | 'fail' | 'busy' | 'hang';
    voices: VoiceLike[];
    synth: boolean;
    nextPlay: (() => Promise<void>) | null;
    /** The browser can play streamed audio and the server streams it. */
    streaming: boolean;
    /** Chunks the fake server sends for a streamed request; `'break'` makes the stream fail there. */
    streamChunks: (Uint8Array | 'break')[];
    playerAllowed: boolean;
  };
  synthCancel: ReturnType<typeof vi.fn>;
}

export function makeSpeech(): FakeSpeech {
  const recognitions: FakeRecognition[] = [];
  const audios: FakeAudio[] = [];
  const revoked: string[] = [];
  const utterances: UtteranceLike[] = [];
  const ttsRequests: FakeSpeech['ttsRequests'] = [];
  const options: FakeSpeech['options'] = {
    recognition: true,
    startThrows: false,
    tts: 'ok',
    voices: [],
    synth: true,
    nextPlay: null,
    streaming: false,
    streamChunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
    playerAllowed: true,
  };
  const players: FakePcmPlayer[] = [];
  const synthCancel = vi.fn();
  let urls = 0;

  const synth: SynthLike = {
    getVoices: () => options.voices,
    speak: (utterance) => {
      utterances.push(utterance);
    },
    cancel: synthCancel,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  const env: SpeechEnv = {
    recognitionCtor: () =>
      options.recognition
        ? class extends FakeRecognition {
            constructor() {
              super();
              recognitions.push(this);
            }
            override start(): void {
              if (options.startThrows) throw new Error('InvalidStateError');
              super.start();
            }
          }
        : undefined,
    synth: () => (options.synth ? synth : undefined),
    createUtterance: () => ({ lang: '', rate: 1, voice: null, onend: null, onerror: null }),
    fetchTts: (body, signal) => {
      ttsRequests.push({ ...body, signal });
      if (options.tts === 'fail') return Promise.reject(new Error('tts down'));
      if (options.tts === 'busy') return Promise.reject(Object.assign(new Error('over limit'), { name: 'TtsBusy' }));
      if (options.tts === 'hang') {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (body.stream && options.streaming) {
        const script = [...options.streamChunks];
        async function* chunks() {
          for (const item of script) {
            await Promise.resolve();
            if (item === 'break') throw new Error('stream broke');
            yield item;
          }
        }
        const stream: TtsStream = { sampleRate: 24000, chunks: chunks() };
        return Promise.resolve(stream);
      }
      return Promise.resolve(new Blob(['audio']));
    },
    streamingSupported: () => options.streaming,
    createPcmPlayer: (sampleRate) => {
      const player = new FakePcmPlayer(sampleRate);
      player.allowed = options.playerAllowed;
      players.push(player);
      return player;
    },
    createAudio: (url) => {
      const audio = new FakeAudio(url);
      if (options.nextPlay) audio.playResult = options.nextPlay;
      audios.push(audio);
      return audio;
    },
    createObjectURL: () => `blob:fake-${(urls += 1)}`,
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
  };

  return { env, controller: new SpeechController(env), recognitions, audios, revoked, utterances, ttsRequests, players, options, synthCancel };
}

/** API double whose scheme check runs the real engine, like the server does. */
export function makeApi(overrides: Partial<Api> = {}): Api & { [K in keyof Api]: ReturnType<typeof vi.fn> } {
  const api = {
    schemeCheck: vi.fn(async (body: Parameters<Api['schemeCheck']>[0]) => ({
      ok: true as const,
      requestId: 'test',
      result: evaluate(body.answers),
    })),
    understand: vi.fn(async (body: Parameters<Api['understand']>[0]) => ({
      ok: true as const,
      requestId: 'test',
      questionId: body.questionId,
      sessionId: body.sessionId,
      interpretation: { kind: 'unclear' as const },
      via: 'keywords' as const,
    })),
    chat: vi.fn(async (body: Parameters<Api['chat']>[0]) => ({
      ok: true as const,
      requestId: 'test',
      reply: { text: 'Test reply', language: body.locale },
      sources: [],
      safety: { urgent: false },
      needsClarification: false,
      provider: 'mock' as const,
    })),
    ...overrides,
  };
  return api as Api & { [K in keyof Api]: ReturnType<typeof vi.fn> };
}

/** A promise that the test resolves by hand, for ordering races deterministically. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
