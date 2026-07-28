/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090d',
          900: '#0c0e14',
          850: '#11141c',
          800: '#161a24',
          700: '#1f2430',
          600: '#2b3140',
          500: '#3a4152',
        },
        accent: {
          DEFAULT: '#6f8dff',
          soft: '#8ea4ff',
          dim: '#3d4d8f',
        },
        haze: '#8b93a7',
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
