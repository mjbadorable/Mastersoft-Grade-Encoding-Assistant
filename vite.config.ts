import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// `npm run preview` sends the same security headers as Firebase Hosting, so the built
// app can be checked locally before deploying.
const firebase = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')) as {
  hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
};
const hostingHeaders = Object.fromEntries(
  (firebase.hosting.headers.find((h) => h.source === '**')?.headers ?? []).map((h) => [h.key, h.value]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths so the static build works on GitHub Pages / Firebase Hosting (D17).
  base: './',
  preview: { headers: hostingHeaders },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
