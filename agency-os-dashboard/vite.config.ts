import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 5173 is the v1 dashboard's default; v2 lives on 5174 so they can run side-by-side
  server: { port: 5174, strictPort: false },
});
