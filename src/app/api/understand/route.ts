import { understandRequestSchema } from '@/lib/api/contracts';
import { handle, jsonOk, readJson } from '@/lib/server/http';
import { enforceLimits } from '@/lib/server/rateLimit';
import { interpret } from '@/lib/server/understand';

export const dynamic = 'force-dynamic';

/** Interpret one questionnaire reply. The answer is returned, never applied, by the server. */
export async function POST(request: Request): Promise<Response> {
  return handle('/api/understand', request, async (requestId) => {
    const body = await readJson(request, understandRequestSchema);
    await enforceLimits(request, 'understand');
    const { interpretation, via } = await interpret(body, request.signal);
    return jsonOk(requestId, {
      questionId: body.questionId,
      sessionId: body.sessionId,
      interpretation,
      via,
    });
  });
}
