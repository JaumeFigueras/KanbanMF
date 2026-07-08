function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Matches the visual weight of the CSS alpha suffixes ('26' / '14') used
// elsewhere for translucent tints — 38/255 and 20/255 respectively.
export const STRONG_TINT_WEIGHT = 38 / 255
export const LIGHT_TINT_WEIGHT = 20 / 255

// Blends `color` into `base` and returns a fully opaque hex color. A card
// nested inside an already-tinted list can't use a translucent bgcolor for
// its own tint — CSS alpha composites with whatever is actually behind it,
// so the list's tint would bleed through and the two colors would visibly
// mix. Pre-blending into a flat, opaque color here means the card always
// shows its own color regardless of what's underneath it.
export function tintColor(color: string, base: string, weight: number): string {
  const [cr, cg, cb] = hexToRgb(color)
  const [br, bg, bb] = hexToRgb(base)
  return rgbToHex(
    cr * weight + br * (1 - weight),
    cg * weight + bg * (1 - weight),
    cb * weight + bb * (1 - weight),
  )
}
