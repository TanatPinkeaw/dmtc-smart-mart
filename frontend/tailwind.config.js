/** @type {import('tailwindcss').Config} */
// ⭐️ Tailwind v3 config. ESM syntax required — package.json sets "type": "module".
//
// These colors were previously declared in src/index.css's v4 `@theme` block as
// --color-brand, --color-brand-dark, etc. In v3 they live here instead; the generated
// utility names (bg-brand, text-brand-mid, border-brand-border, …) stay identical, so no
// component markup had to change.
//
// Values are plain sRGB hex on purpose. v3 compiles these to rgb()/rgba() rather than the
// oklch/oklab + @property output v4 produced, which is what broke gradients and translucent
// overlays on Safari 15 (iPhone 7 tops out at iOS 15.8, below v4's Safari 16.4+ target).
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#F12B6B',
        'brand-dark': '#FF467E',
        // ⭐️ brand-mid is used 29x across the app (text-brand-mid, border-brand-mid,
        // bg-brand-mid) — carried over from the old @theme block. Dropping it would make
        // those utilities silently resolve to nothing.
        'brand-mid': '#FD94B4',
        'brand-border': '#F6C7C7',
        'brand-bg': '#FFF5F7',
        'neutral-bg': '#F8FAFC',
        'neutral-border': '#E2E8F0',
      },
    },
  },
  plugins: [],
}
