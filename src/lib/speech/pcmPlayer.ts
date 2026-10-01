import type { PcmPlayerLike } from './controller';

/**
 * Plays raw 16-bit mono PCM with the Web Audio API as chunks arrive, so a
 * spoken reply starts within about a second instead of after the whole clip
 * has been generated. Browser-only; unit tests use a fake player.
 */

type ContextCtor = new () => AudioContext;

function contextCtor(): ContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function pcmStreamingSupported(): boolean {
  return contextCtor() !== undefined;
}

/** A little audio is queued ahead before the first chunk plays, to ride out uneven network delivery. */
const LEAD_SECONDS = 0.12;

export function createPcmPlayer(sampleRate: number): PcmPlayerLike | undefined {
  const Ctor = contextCtor();
  if (!Ctor) return undefined;
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return undefined;
  }

  let playhead = 0;
  let scheduled = 0;
  let finished = false;
  let stopped = false;
  /** A network chunk can end in the middle of a 2-byte sample; the odd byte waits for the next chunk. */
  let carry: number | null = null;

  const player: PcmPlayerLike = {
    onended: null,

    async ready() {
      try {
        if (context.state === 'suspended') await context.resume();
      } catch {
        // Reported through the state check below.
      }
      return context.state === 'running';
    },

    enqueue(chunk) {
      if (stopped) return;
      let bytes = chunk;
      if (carry !== null) {
        const joined = new Uint8Array(chunk.byteLength + 1);
        joined[0] = carry;
        joined.set(chunk, 1);
        bytes = joined;
        carry = null;
      }
      if (bytes.byteLength % 2 === 1) {
        carry = bytes[bytes.byteLength - 1] ?? null;
        bytes = bytes.subarray(0, bytes.byteLength - 1);
      }
      const samples = bytes.byteLength / 2;
      if (samples === 0) return;

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const buffer = context.createBuffer(1, samples, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      // Each chunk starts exactly where the previous one ends.
      const at = Math.max(context.currentTime + LEAD_SECONDS, playhead);
      source.start(at);
      playhead = at + buffer.duration;
      scheduled += 1;
      source.onended = () => {
        scheduled -= 1;
        if (finished && scheduled === 0 && !stopped) player.onended?.();
      };
    },

    finish() {
      finished = true;
      if (scheduled === 0 && !stopped) player.onended?.();
    },

    stop() {
      if (stopped) return;
      stopped = true;
      void context.close().catch(() => undefined);
    },
  };
  return player;
}
