import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sakho AI',
    short_name: 'Sakho AI',
    description: 'A voice-first helper for women in rural India.',
    start_url: '/',
    // `browser`, not `standalone`: there is no service worker, so the app does not work offline after a reload.
    display: 'browser',
    background_color: '#fbf7f0',
    theme_color: '#0b5d5e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
