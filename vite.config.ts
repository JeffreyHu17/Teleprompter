import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const android = process.env.VITE_TARGET === 'android';
  return {
  base: './',
  plugins: [
    react(),
    {
      name: 'teleprompter-platform-entry',
      transformIndexHtml: {
        order: 'pre',
        handler: (html: string) => android ? html.replace('/src/desktop/main.tsx', '/src/mobile/main.android.tsx') : html,
      },
    },
  ],
  build: {
    outDir: android ? 'dist-android' : 'dist',
  },
  };
});
