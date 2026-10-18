import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths so the static build works on GitHub Pages / Firebase Hosting (D17).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
