/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        substrate: '#0c0b09',
        surface: '#161411',
        'surface-hi': '#1d1a15',
        seam: '#2a2620',
        'seam-hi': '#3a342b',
        amber: '#c19a3d',
        'amber-dim': '#8c6f2a',
        'amber-hot': '#f4c86a',
        phosphor: '#7fffa9',
        'phosphor-dim': '#3aa66a',
        sanguine: '#ff4b4b',
        'sanguine-dim': '#a03232',
        bone: '#f4ede1',
        'bone-dim': '#c6bfb3',
        dust: '#8e867c',
        ink: '#1f1b17',
        parchment: '#e8e0d0',
      },
      fontFamily: {
        display: ['Rebels', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
        serif: ['serif'],
      },
      fontSize: {
        eyebrow: ['10px', { letterSpacing: '0.22em' }],
      },
      animation: {
        'marquee-up': 'marquee-up 6s ease-in-out infinite',
        'marquee-down': 'marquee-down 6s ease-in-out infinite',
        'marquee-pulse': 'marquee-pulse 3s ease-in-out infinite',
        'pit-reveal': 'pit-reveal 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'pit-ticker': 'pit-ticker 80s linear infinite',
      },
      keyframes: {
        'marquee-up': {
          '0%': { transform: 'translate3d(0, 0, 0)' },
          '100%': { transform: 'translate3d(0, -50%, 0)' },
        },
        'marquee-down': {
          '0%': { transform: 'translate3d(0, -50%, 0)' },
          '100%': { transform: 'translate3d(0, 0, 0)' },
        },
        'marquee-pulse': {
          '0%, 100%': { opacity: '0.15', transform: 'scale(1) translateY(0)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05) translateY(-2px)' },
        },
        'pit-reveal': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pit-ticker': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};
