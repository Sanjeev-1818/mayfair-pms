import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': `http://localhost:${process.env.API_PORT || 5000}`, '/l/': `http://localhost:${process.env.API_PORT || 5000}` },
  },
});
