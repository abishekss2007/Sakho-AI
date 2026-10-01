// Runs the production standalone server the same way the container does.
// `next build` with output: 'standalone' does not copy static assets, so they
// are copied here first.
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

if (!existsSync(join(standalone, 'server.js'))) {
  console.error('No production build found. Run "npm run build" first.');
  process.exit(1);
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });
}

const child = spawn(process.execPath, [join(standalone, 'server.js')], {
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0', PORT: process.env.PORT ?? '3000' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
