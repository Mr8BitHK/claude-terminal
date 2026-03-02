import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: './src/web-client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/web-client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve('src/renderer'),
      '@shared': path.resolve('src/shared'),
    },
  },
});
