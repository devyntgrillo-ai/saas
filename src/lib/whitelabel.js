// White-label theming: derive a full primary palette from a single brand color
// and apply it to the CSS variables that drive Tailwind's `primary` scale.
//
// Tailwind is configured with `rgb(var(--primary-N) / <alpha-value>)`, so setting
// these variables recolors every `bg-primary`, `text-primary-400`, `border-primary/30`,
// etc. across the app - including opacity modifiers.

const SHADE_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

// How far each shade is mixed toward white (negative) or black (positive) from
// the base 600 color. 0 = the base color itself.
const MIX = {
  50: -0.92,
  100: -0.84,
  200: -0.68,
  300: -0.48,
  400: -0.26,
  500: -0.1,
  600: 0,
  700: 0.18,
  800: 0.32,
  900: 0.46,
  950: 0.62,
}

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))

// amount < 0 → mix toward white; amount > 0 → mix toward black.
function mix([r, g, b], amount) {
  if (amount < 0) {
    const t = -amount
    return [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]
  }
  const t = 1 - amount
  return [r * t, g * t, b * t]
}

// Darken a hex color by a percentage (toward black).
export function darkenColor(hex, percent) {
  const num = parseInt(String(hex).replace('#', ''), 16)
  const d = Math.round((255 * percent) / 100)
  const r = Math.max(0, (num >> 16) - d)
  const g = Math.max(0, ((num >> 8) & 0xff) - d)
  const b = Math.max(0, (num & 0xff) - d)
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// hex → rgba() string at the given alpha (0–1).
function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

// CSS variables that hold a literal color (hex/rgba) rather than the Tailwind
// "R G B" triple. --accent drives the Logo wordmark accent + various pills;
// the --color-primary* aliases cover any element styled directly off them.
const LITERAL_VARS = [
  '--accent',
  '--color-primary',
  '--color-primary-100',
  '--color-primary-300',
  '--color-primary-400',
  '--color-primary-500',
  '--color-primary-600',
]

/** Apply a white-label brand color. Returns true if applied. */
export function applyPrimaryColor(hex) {
  const base = hexToRgb(hex)
  if (!base) {
    resetPrimaryColor()
    return false
  }
  const root = document.documentElement
  // Tailwind `primary` scale (drives bg-primary, text-primary-300, border-primary/30, …).
  for (const key of SHADE_KEYS) {
    const [r, g, b] = mix(base, MIX[key])
    root.style.setProperty(`--primary-${key}`, `${clamp(r)} ${clamp(g)} ${clamp(b)}`)
  }
  // Literal-color vars: the brand accent + spec aliases, with derived shades.
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--color-primary', hex)
  root.style.setProperty('--color-primary-400', hex)
  root.style.setProperty('--color-primary-500', hex)
  root.style.setProperty('--color-primary-100', hexToRgba(hex, 0.1))
  root.style.setProperty('--color-primary-300', hexToRgba(hex, 0.6))
  root.style.setProperty('--color-primary-600', darkenColor(hex, 15))
  return true
}

/** Revert to the default palette defined in index.css. */
export function resetPrimaryColor() {
  const root = document.documentElement
  for (const key of SHADE_KEYS) {
    root.style.removeProperty(`--primary-${key}`)
  }
  for (const v of LITERAL_VARS) {
    root.style.removeProperty(v)
  }
}
