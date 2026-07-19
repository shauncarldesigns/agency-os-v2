/** @type {import('tailwindcss').Config} */
// Light-theme era (Phase 3): preflight is ON — the whole app is light-mode
// Tailwind now. global.css survives as a legacy layer of semantic classes
// (.btn, .weekplan, …) resolving to light tokens; panels migrate off it
// incrementally, then it gets deleted.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
