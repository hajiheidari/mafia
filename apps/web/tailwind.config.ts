import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Premium dark gaming palette — see ARCHITECTURE.md UX requirements.
        bg: '#0B0B14',
        surface: '#151521',
        accent: '#7C5CFC',
        accentSoft: '#A78BFA',
      },
      fontFamily: {
        vazir: ['var(--font-vazirmatn)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
