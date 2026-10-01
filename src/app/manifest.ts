import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sakho',
    short_name: 'Sakho',
    description: 'A voice-first helper for women in rural India.',
    start_url: '/',
    // `browser`, not `standalone`: there is no service worker, so the app does not work offline after a reload.
    display: 'browser',
    background_color: '#f6f5fb',
    theme_color: '#5b3df5',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
