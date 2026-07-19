/** @type {import('tailwindcss').Config} */
// Phase 1 of the light-theme migration: Tailwind is present ONLY as a utility
// generator. Preflight is disabled so the global dark-theme reset in
// src/styles/global.css stays untouched. Utility classes work anywhere but
// visual light-mode isolation happens inside a `.pipeline-scope` wrapper
// (see src/styles/pipeline-scope.css). Phase 3 flips preflight on and
// retires global.css.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
