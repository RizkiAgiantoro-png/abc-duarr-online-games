import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? 3000}`;
  return {
    plugins: [react(), tailwind()],
    build: { outDir: 'dist/web' },
    server: { proxy: { '/socket.io': { target, ws: true }, '/healthz': target } },
  };
});
