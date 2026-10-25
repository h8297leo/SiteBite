import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwind()], server: { host: '127.0.0.1', watch:{ignored:['**/playwright-report/**','**/test-results/**','**/.cache/**','**/docs/**','**/scripts/**','**/tests/**','**/server/**','**/VERSION.json','**/SOURCE-MANIFEST.json']} } });
