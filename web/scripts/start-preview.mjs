import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { preview } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

function runBuild() {
  console.log('Building production bundle...');
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
}

async function startPreview() {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 4173);

  console.log(`Starting Vite preview server on ${host}:${port}...`);

  const server = await preview({
    root: projectRoot,
    preview: {
      host,
      port,
      strictPort: true,
    },
  });

  server.printUrls();

  const shutdown = async () => {
    console.log('\nShutting down preview server...');
    const httpServer = server.httpServer;
    if (httpServer && typeof httpServer.close === 'function') {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function main() {
  runBuild();
  await startPreview();
}

main().catch((error) => {
  console.error('Failed to start preview server', error);
  process.exit(1);
});
