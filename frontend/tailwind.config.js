/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#080D19',
          surface: '#111A2B',
          secondary: '#18243A',
          elevated: '#1C2940',
        },
        border: {
          subtle: '#26354B',
          highlight: '#3B4F6E',
        },
        accent: {
          cyan: '#22D3EE',
          violet: '#A78BFA',
          emerald: '#34D399',
          amber: '#FBBF24',
          rose: '#F87171',
        },
        text: {
          primary: '#F1F5F9',
          secondary: '#94A3B8',
          muted: '#64748B',
        }
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px -5px rgba(34, 211, 238, 0.25)',
        'glow-violet': '0 0 20px -5px rgba(167, 139, 250, 0.25)',
        'surface': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      }
    },
  },
  plugins: [],
}
