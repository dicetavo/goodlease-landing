/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Repris de l'app Flutter — lib/styles/colors/custom_colors.dart
        primary: {
          DEFAULT: '#1675F3',
          bold: '#4491F5',
          dark: '#155EEF',
          border: '#1758AD',
          50: '#F6FBFF',
          100: '#E9F2FE',
          200: '#CEE0FB',
          300: '#C7E2FF',
        },
        ink: {
          DEFAULT: '#1A1C1E',
          2: '#232F51',
        },
        muted: {
          DEFAULT: '#6C7278',
          light: '#717680',
          soft: '#898989',
        },
        field: '#EDF1F3',
        surface: '#FFFFFF',
        canvas: '#F5F7F7',
        line: '#EEEEEE',
        success: '#039855',
        online: '#17B26A',
        warning: '#FFC403',
        danger: '#F44336',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        btn: '13px',
        field: '10px',
        card: '16px',
      },
      boxShadow: {
        soft: '0 8px 24px -6px rgba(26, 28, 30, 0.10)',
        card: '0 12px 40px -12px rgba(22, 117, 243, 0.18)',
        phone: '0 30px 60px -20px rgba(26, 28, 30, 0.35)',
      },
      maxWidth: {
        content: '1120px',
      },
    },
  },
  plugins: [],
};
