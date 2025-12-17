import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-codicons',
      closeBundle() {
        // Copy codicons CSS and font files to output directory
        const codiconsDir = resolve(__dirname, '../node_modules/@vscode/codicons/dist');
        const outDir = resolve(__dirname, '../out/webview/codicons');
        
        try {
          mkdirSync(outDir, { recursive: true });
          copyFileSync(resolve(codiconsDir, 'codicon.css'), resolve(outDir, 'codicon.css'));
          copyFileSync(resolve(codiconsDir, 'codicon.ttf'), resolve(outDir, 'codicon.ttf'));
          console.log('✓ Copied codicons assets');
        } catch (err) {
          console.error('Failed to copy codicons:', err);
        }
      },
    },
  ],
  build: {
    outDir: '../out/webview',
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: 'sidebar.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'sidebar.css';
          return assetInfo.name || '';
        },
      },
    },
  },
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
