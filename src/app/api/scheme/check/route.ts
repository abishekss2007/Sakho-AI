import { schemeCheckRequestSchema } from '@/lib/api/contracts';
import { evaluate } from '@/lib/scheme/engine';
import { handle, jsonOk, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Evaluate questionnaire answers with the shared rules engine. No provider calls. */
export async function POST(request: Request): Promise<Response> {
  return handle('/api/scheme/check', request, async (requestId) => {
    const body = await readJson(request, schemeCheckRequestSchema);
    return jsonOk(requestId, { result: evaluate(body.answers) });
  });
}
