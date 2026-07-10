/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // No darkMode: 'class' needed — dark is the default in CSS
  theme: {
    extend: {
      colors: {
        'bg-primary': 'hsl(var(--bg-primary))',
        'card-bg': 'hsl(var(--card-bg-h), var(--card-bg-s), var(--card-bg-l))',
        'card-border': 'hsl(var(--card-border-h), var(--card-border-s), var(--card-border-l))',
        'text-main': 'hsl(var(--text-main))',
        'text-muted': 'hsl(var(--text-muted))',
        'accent-color': 'hsl(var(--accent-color))',
        'theme-primary': 'hsl(var(--theme-primary))',
      },
      fontFamily: {
        hero: ['Outfit', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
