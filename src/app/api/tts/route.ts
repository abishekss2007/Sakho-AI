import { ttsRequestSchema } from '@/lib/api/contracts';
import { handle, readJson } from '@/lib/server/http';
import { enforceLimits } from '@/lib/server/rateLimit';
import { synthesize } from '@/lib/server/tts';

export const dynamic = 'force-dynamic';

/** Speech audio for a short piece of text. Errors use the JSON error envelope. */
export async function POST(request: Request): Promise<Response> {
  return handle('/api/tts', request, async (requestId) => {
    const body = await readJson(request, ttsRequestSchema);
    await enforceLimits(request, 'tts');
    const audio = await synthesize(body, request.signal);
    return new Response(audio.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': audio.contentType,
        'Content-Length': String(audio.bytes.byteLength),
        // Spoken text can be personal, so it is never cached.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
      },
    });
  });
}
