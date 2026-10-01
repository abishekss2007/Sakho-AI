import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // layout/page are thin server shells exercised by the Playwright suite.
      exclude: ['src/app/layout.tsx', 'src/app/page.tsx', 'src/app/manifest.ts'],
      thresholds: { lines: 88, statements: 88, functions: 85, branches: 80 },
    },
  },
});
