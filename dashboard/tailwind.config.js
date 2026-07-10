/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-primary':   'hsl(var(--bg-primary))',
        'card-bg':      'rgba(var(--card-bg-rgb), 0.12)',
        'card-border':  'rgba(var(--card-border-rgb), 0.25)',
        'text-main':    'hsl(var(--text-main))',
        'text-muted':   'hsl(var(--text-muted))',
        'accent-color': 'hsl(var(--accent-color))',
        'theme-primary':'hsl(var(--theme-primary))',
      },
      fontFamily: {
        hero: ['Outfit', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
