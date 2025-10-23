/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'Noto Sans KR', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        ellie: {
          yellow: '#ffd331',
          ivory: '#f5eee9',
          text: '#404040',
          border: '#e6dccc',
          hover: '#ffec8b',
        },
      },
      boxShadow: {
        ellie: '0 18px 40px -20px rgba(64, 64, 64, 0.25)',
      },
    },
  },
  plugins: [],
}
