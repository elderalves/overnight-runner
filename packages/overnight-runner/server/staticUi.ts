import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/web's Vite build output, read at runtime -- resolves to
// packages/web whether this file runs from packages/overnight-runner/server
// (Node's native type-stripping, no build step).
function resolveWebDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
}

const ASSET_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
};

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTML_TYPE = 'text/html; charset=utf-8';

function isSafeAssetFilename(file: string): boolean {
  return file.length > 0 && file !== '.' && file !== '..' && !file.includes('/') && !file.includes('\\') && !file.includes('\0');
}

function assetContentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return ASSET_TYPES[ext] ?? 'application/octet-stream';
}

let hintLogged = false;
const BUILD_HINT_HTML = `<!doctype html>
<html><body style="font:14px system-ui;padding:2rem">
<h1>overnight-runner serve</h1>
<p><code>packages/web/dist</code> is missing -- run <code>npm run build -w web</code> first.</p>
</body></html>`;

interface StaticUi {
  distDir: string;
  serveIndex(): Response;
  serveAsset(file: string): Response;
}

function createStaticUi(): StaticUi {
  const distDir = join(resolveWebDir(), 'dist');

  return {
    distDir,
    serveIndex(): Response {
      const indexPath = join(distDir, 'index.html');
      if (!existsSync(indexPath)) {
        if (!hintLogged) {
          hintLogged = true;
          console.log('overnight-runner: packages/web/dist is missing -- run `npm run build -w web`.');
        }
        return new Response(BUILD_HINT_HTML, { headers: { 'content-type': HTML_TYPE } });
      }
      return new Response(readFileSync(indexPath), { headers: { 'content-type': HTML_TYPE } });
    },
    serveAsset(file: string): Response {
      if (!isSafeAssetFilename(file)) return new Response('not found', { status: 404 });
      const assetPath = join(distDir, 'assets', file);
      if (!existsSync(assetPath) || !statSync(assetPath).isFile()) return new Response('not found', { status: 404 });
      return new Response(readFileSync(assetPath), {
        headers: { 'content-type': assetContentType(file), 'cache-control': ASSET_CACHE_CONTROL },
      });
    },
  };
}

export { createStaticUi, isSafeAssetFilename, assetContentType };
