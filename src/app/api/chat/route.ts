import { chatRequestSchema } from '@/lib/api/contracts';
import { runChat } from '@/lib/server/chat';
import { handle, jsonOk, readJson } from '@/lib/server/http';
import { enforceLimits } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
// Serverless hosts stop a function after a default time limit; these calls wait on an AI provider.
export const maxDuration = 60;

/** Conversational reply from Gemini with validated sources and safety metadata. */
export async function POST(request: Request): Promise<Response> {
  return handle('/api/chat', request, async (requestId) => {
    const body = await readJson(request, chatRequestSchema);
    await enforceLimits(request, 'chat');
    return jsonOk(requestId, await runChat(body, request.signal));
  });
}
