import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: 5176, // antes 5174; movido para no chocar con avoqado-checkout (que usa 5174)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    lib: {
      entry: 'src/widget.ts',
      name: 'AvoqadoBooking',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      external: [],
    },
    cssCodeSplit: false,
    target: 'es2017',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
})
