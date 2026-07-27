import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// ⭐️ Tailwind runs through PostCSS (see postcss.config.js), not a Vite plugin — that's the
// Tailwind v3 setup. The v4-only @tailwindcss/vite plugin was removed in the v3 downgrade.
export default defineConfig({
  plugins: [
    react(),
  ],
})