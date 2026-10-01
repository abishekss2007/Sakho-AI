import { ttsRequestSchema } from '@/lib/api/contracts';
import { handle, readJson } from '@/lib/server/http';
import { enforceLimits } from '@/lib/server/rateLimit';
import { openSpeech } from '@/lib/server/tts';

export const dynamic = 'force-dynamic';

// Spoken text can be personal, so audio is never cached by browsers or proxies.
const AUDIO_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;

/**
 * Speech audio for a short piece of text: a complete file, or raw PCM relayed
 * as it is generated when the request asks for `stream`. Errors use the JSON
 * error envelope.
 */
export async function POST(request: Request): Promise<Response> {
  return handle('/api/tts', request, async (requestId) => {
    const body = await readJson(request, ttsRequestSchema);
    await enforceLimits(request, 'tts');
    const speech = await openSpeech(body, request.signal);

    if (speech.kind === 'file') {
      return new Response(speech.audio.bytes as BodyInit, {
        status: 200,
        headers: {
          ...AUDIO_HEADERS,
          'Content-Type': speech.audio.contentType,
          'Content-Length': String(speech.audio.bytes.byteLength),
          'X-Request-Id': requestId,
        },
      });
    }

    const { chunks } = speech;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await chunks.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch {
          // The provider failed part-way: end the audio where it is.
          controller.close();
        }
      },
      async cancel() {
        await chunks.return();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...AUDIO_HEADERS,
        'Content-Type': `audio/l16;rate=${speech.sampleRate};channels=1`,
        // Ask proxies not to hold the audio back until it is complete.
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId,
      },
    });
  });
}
