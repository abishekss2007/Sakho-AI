import { ClientRoot } from '@/components/ClientRoot';
import { mockProviders, sosMode } from '@/lib/server/config';

// Rendered per request so SOS_MODE is read from the running container, not baked into the build.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <ClientRoot sosMode={sosMode()} providers={mockProviders() ? 'mock' : 'live'} />;
}
