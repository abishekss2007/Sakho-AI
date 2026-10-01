'use client';

import dynamic from 'next/dynamic';
import type { SosMode } from '@/lib/emergency';

/**
 * The app reads saved preferences from the device on first render, so it is
 * rendered in the browser only. This avoids a server/client mismatch.
 */
const App = dynamic(() => import('./App').then((m) => m.App), {
  ssr: false,
  loading: () => (
    <p className="p-6 text-2xl font-bold" role="status">
      Sakho AI
    </p>
  ),
});

export function ClientRoot(props: { sosMode: SosMode; providers: 'live' | 'mock' }) {
  return <App {...props} />;
}
