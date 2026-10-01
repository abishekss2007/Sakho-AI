import type { HealthResponse } from '@/lib/api/contracts';
import { mockProviders, sosMode } from '@/lib/server/config';
import { getStore } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';

/** Liveness only: no provider calls, no secrets, no configuration values. */
export function GET(): Response {
  const body: HealthResponse = {
    ok: true,
    service: 'sakho-ai',
    providers: mockProviders() ? 'mock' : 'live',
    sosMode: sosMode(),
    rateLimit: getStore().kind,
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
