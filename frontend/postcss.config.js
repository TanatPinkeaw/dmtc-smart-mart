// ⭐️ Tailwind v3 runs as a PostCSS plugin (v4 used the @tailwindcss/vite plugin instead).
// ESM syntax is required here — package.json sets "type": "module", so a CommonJS
// `module.exports = {}` would fail to load.
//
// autoprefixer is what adds the vendor prefixes older mobile browsers need; it's the reason
// this setup works on Safari 15 / older Android without the hand-written @supports fallbacks
// the v4 build required.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
