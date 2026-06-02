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

/** Apply a white-label brand color. Returns true if applied. */
export function applyPrimaryColor(hex) {
  const base = hexToRgb(hex)
  if (!base) {
    resetPrimaryColor()
    return false
  }
  const root = document.documentElement
  for (const key of SHADE_KEYS) {
    const [r, g, b] = mix(base, MIX[key])
    root.style.setProperty(`--primary-${key}`, `${clamp(r)} ${clamp(g)} ${clamp(b)}`)
  }
  return true
}

/** Revert to the default palette defined in index.css. */
export function resetPrimaryColor() {
  const root = document.documentElement
  for (const key of SHADE_KEYS) {
    root.style.removeProperty(`--primary-${key}`)
  }
}
