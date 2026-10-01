// Removes previous production build output before `next build`.
// In cloud-synced folders on Windows (for example OneDrive), old output
// directories can become reparse points that Next.js fails to delete itself.
// The dev server's own directory (.next/dev) is left alone.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '.next');
if (existsSync(dir)) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'dev' || entry === 'cache') continue;
    rmSync(join(dir, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
