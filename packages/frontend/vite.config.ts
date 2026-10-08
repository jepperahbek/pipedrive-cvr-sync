import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built panel works regardless of the path Pipedrive serves it from.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    // Local dev: proxy API calls to the backend so the panel can talk to it.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
