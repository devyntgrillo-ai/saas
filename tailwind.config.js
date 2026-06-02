/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables so an agency's white-label primary_color can
        // override the default blue at runtime. Defaults live in src/index.css.
        primary: {
          DEFAULT: 'rgb(var(--primary-600) / <alpha-value>)',
          50: 'rgb(var(--primary-50) / <alpha-value>)',
          100: 'rgb(var(--primary-100) / <alpha-value>)',
          200: 'rgb(var(--primary-200) / <alpha-value>)',
          300: 'rgb(var(--primary-300) / <alpha-value>)',
          400: 'rgb(var(--primary-400) / <alpha-value>)',
          500: 'rgb(var(--primary-500) / <alpha-value>)',
          600: 'rgb(var(--primary-600) / <alpha-value>)',
          700: 'rgb(var(--primary-700) / <alpha-value>)',
          800: 'rgb(var(--primary-800) / <alpha-value>)',
          900: 'rgb(var(--primary-900) / <alpha-value>)',
          950: 'rgb(var(--primary-950) / <alpha-value>)',
        },
        // Surface palette — driven by CSS-variable channels so it flips between
        // dark and light themes (see :root / :root.light in src/index.css).
        surface: {
          DEFAULT: 'rgb(var(--s-base) / <alpha-value>)', // page background
          900: 'rgb(var(--s-surface) / <alpha-value>)', // cards / panels
          800: 'rgb(var(--s-elevated) / <alpha-value>)', // modals / dropdowns / hover
          700: 'rgb(var(--s-subtle) / <alpha-value>)', // dividers & input bg
          600: 'rgb(var(--s-strong) / <alpha-value>)', // strong border / hover
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // One consistent elevation level across the whole app.
        card: '0 1px 3px rgba(0,0,0,0.4)',
        glow: '0 1px 3px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
