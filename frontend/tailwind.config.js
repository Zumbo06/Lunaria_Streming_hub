/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Every colour resolves through a CSS variable so switching the theme is a
      // single attribute on <html> rather than a rebuild.
      colors: {
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          dim: 'rgb(var(--accent-dim) / <alpha-value>)',
        },
        haze: 'rgb(var(--haze) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        poster: '0 12px 32px -12px rgba(0, 0, 0, 0.85)',
        lift: '0 0 0 1px rgba(111, 141, 255, 0.45), 0 16px 40px -16px rgba(111, 141, 255, 0.55)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-480px 0' },
          '100%': { backgroundPosition: '480px 0' },
        },
        risein: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s linear infinite',
        risein: 'risein 0.28s ease-out both',
      },
    },
  },
  plugins: [],
}
