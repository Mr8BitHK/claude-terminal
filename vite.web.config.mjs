import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: './src/web-client',
  plugins: [react()],
  build: {
    outDir: '../../dist/web-client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve('src/shared'),
    },
  },
});
