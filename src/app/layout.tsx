import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sakho',
  description:
    'Sakho is a voice-first helper for women in rural India: ask questions, get early guidance on maternity benefits, and find emergency numbers.',
  applicationName: 'Sakho',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b3df5',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // `lang` and `dir` are updated in the browser to match the language actually displayed.
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
