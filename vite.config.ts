import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// `npm run preview` sends the same security headers as Firebase Hosting, so the built
// app can be checked locally before deploying.
const firebase = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')) as {
  hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
};
const hostingHeaders = Object.fromEntries(
  (firebase.hosting.headers.find((h) => h.source === '**')?.headers ?? []).map((h) => [h.key, h.value]),
);

/**
 * Offline support: writes dist/sw.js from src/sw.js with the list of built files to save
 * on first visit, and a version that changes whenever any of them changes.
 */
function offline(): Plugin {
  const publicFiles = ['manifest.webmanifest', 'icon.svg'];
  return {
    name: 'offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      for (const out of Object.values(bundle)) hash.update(out.type === 'chunk' ? out.code : out.source);
      for (const f of publicFiles) hash.update(readFileSync(new URL(`./public/${f}`, import.meta.url)));
      // './' is the page itself: Firebase serves index.html there (and redirects /index.html to it).
      const files = ['./', ...publicFiles, ...Object.keys(bundle).filter((f) => f !== 'index.html').sort()];
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), offline()],
  // Relative paths so the static build works on GitHub Pages / Firebase Hosting (D17).
  base: './',
  preview: { headers: hostingHeaders },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
