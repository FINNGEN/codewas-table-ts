import type { CSSProperties } from "react"
import { rampColor } from "./heatmapUtils"
import { appTheme } from "../../../theme"
import { HEATMAP_EMPTY_COLOR } from "../constants"

/* ============================================================================
 * HEATMAP TEXTURE RAMP — the whole tweak surface lives in this block.
 *
 * Evidence strength is encoded as *texture* density instead of color intensity,
 * which frees the color channel for other variables. Cells are quantized into
 * HEATMAP_PATTERNS.length ordered levels (weakest first); everything else in the
 * app (the global bucket slider, the legend, the color fallback) derives its
 * step count from that array, so adding or removing a level is a one-line edit.
 * ========================================================================== */

// "pattern" = textures (this experiment). "color" = the old red ramp, quantized
// into the same levels so the two encodings are directly comparable.
export const HEATMAP_ENCODING: "pattern" | "color" = "color"

export const PATTERN_INK = appTheme.palette.pvalue.main // the marks
export const PATTERN_BG = appTheme.palette.background.default // behind the marks
export const PATTERN_EMPTY = HEATMAP_EMPTY_COLOR // cells with no value at all (see constants.ts)

// Shapes the continuous scale before quantizing: 1 = linear, < 1 lifts weak
// cells into higher levels, > 1 pushes everything toward the bottom.
export const PATTERN_SCALE_GAMMA = 1

// Fraction of the column/global max below which a cell is left blank instead of
// getting level 1. 0 = every non-null cell gets at least the faintest texture.
export const PATTERN_BLANK_BELOW = 0

export type PatternSpec =
  | {
      kind: "dots"
      tile: number // repeat period in CSS px = the dot grid pitch
      radius: number // dot radius in CSS px
      count: number // dots per cluster, laid along `angleDeg`
      gap: number // center-to-center distance inside a cluster
      angleDeg: number // cluster axis; 45 = up-right
    }
  | {
      kind: "lines"
      tile: number // *hint* for the repeat period; snapped up to a whole number of lines
      width: number // stroke width (in inverted mode: the width of the *gaps*)
      spacing: number // perpendicular distance between lines — always honored exactly
      angleDeg: number // 45 = "/", 135 = "\"; snapped to the nearest tileable slope (see LINE_SLOPES)
      inverted?: boolean // ink-filled tile with background-colored lines — reads as the negative
    }

// Weakest → strongest.
export const HEATMAP_PATTERNS: PatternSpec[] = [
  // 1 — sparse dot grid
  { kind: "dots", tile: 7, radius: 1.0, count: 1, gap: 2.5, angleDeg: 45 },
  // 2 — dot pairs at 45°
  { kind: "dots", tile: 7, radius: 1.0, count: 2, gap: 2.5, angleDeg: 45 },
  // 3 — dot triplets at 45°
  { kind: "dots", tile: 7, radius: 1.0, count: 3, gap: 2.5, angleDeg: 45 },
  // 4 — thin diagonal lines
  { kind: "lines", tile: 8, width: 1.0, spacing: 4, angleDeg: 60 },
  // 5 — thick diagonal lines
  { kind: "lines", tile: 8, width: 2, spacing: 4, angleDeg: 60 },
  // 6 — inverted: mostly ink, the thin gaps read as the pattern
  { kind: "lines", tile: 8, width: 3, spacing: 4, angleDeg: 60, inverted: false },
  // { kind: "lines", tile: 8, width: 4, spacing: 4, angleDeg: 60, inverted: false },
]

/* ========================================================================== */

export const HEATMAP_LEVEL_COUNT = HEATMAP_PATTERNS.length

// Color fallback (HEATMAP_ENCODING === "color") and the swatches the bucket
// slider falls back to: the ramp sampled at each level's midpoint.
export const HEATMAP_LEVEL_COLORS = HEATMAP_PATTERNS.map((_, index) =>
  rampColor((index + 0.5) / HEATMAP_LEVEL_COUNT),
)

// --- quantization ----------------------------------------------------------

// Continuous scale (per-column / global max) → level index, or null for a blank cell.
export function heatmapPatternLevel(value: number | null, maxValue: number): number | null {
  if (value == null) return null
  if (!Number.isFinite(value)) return HEATMAP_LEVEL_COUNT - 1
  const ratio = Math.max(0, Math.min(1, value / Math.max(maxValue, 1)))
  if (ratio < PATTERN_BLANK_BELOW) return null
  const shaped = PATTERN_SCALE_GAMMA === 1 ? ratio : Math.pow(ratio, PATTERN_SCALE_GAMMA)
  return Math.min(HEATMAP_LEVEL_COUNT - 1, Math.floor(shaped * HEATMAP_LEVEL_COUNT))
}

// Bucketed scale (draggable breakpoints) → level index. One level per bucket, so
// `breakpoints.length` must be HEATMAP_LEVEL_COUNT - 1.
export function bucketPatternLevel(value: number | null, breakpoints: number[]): number | null {
  if (value == null) return null
  if (!Number.isFinite(value)) return HEATMAP_LEVEL_COUNT - 1
  let bucket = 0
  while (bucket < breakpoints.length && value >= breakpoints[bucket]) bucket++
  return Math.min(bucket, HEATMAP_LEVEL_COUNT - 1)
}

// --- line geometry ---------------------------------------------------------

// A family of parallel lines only repeats inside a square tile when its slope is rational: the tile
// edges have to land on line positions, and for an irrational slope they never do (that is why a raw
// 60° hatch shows a seam at every tile boundary). `angleDeg` is therefore snapped to the nearest
// rise:run here — 30° → 26.6°, 60° → 63.4°.
const LINE_SLOPES: [number, number][] = [
  [0, 1], // 0°
  [1, 3], // 18.4°
  [1, 2], // 26.6°
  [2, 3], // 33.7°
  [1, 1], // 45°
  [3, 2], // 56.3°
  [2, 1], // 63.4°
  [3, 1], // 71.6°
  [1, 0], // 90°
]

// Snapped slope as integer rise:run. Angles past 90° mirror it ("/" becomes "\").
function lineSlope(angleDeg: number) {
  const normalized = ((angleDeg % 180) + 180) % 180
  const target = normalized > 90 ? 180 - normalized : normalized
  let best = LINE_SLOPES[0]
  let bestError = Number.POSITIVE_INFINITY
  for (const candidate of LINE_SLOPES) {
    const error = Math.abs((Math.atan2(candidate[0], candidate[1]) * 180) / Math.PI - target)
    if (error < bestError) {
      bestError = error
      best = candidate
    }
  }
  const rise = best[0]
  const run = normalized > 90 ? -best[1] : best[1]
  return { rise, run, length: Math.hypot(rise, run) }
}

// Repeat period of a spec, in CSS px. For lines it is the whole number of line periods closest to
// `tile`, which is what keeps `spacing` exact *and* the tile seamless.
function specTile(spec: PatternSpec) {
  if (spec.kind === "dots") return spec.tile
  const period = spec.spacing * lineSlope(spec.angleDeg).length
  return Math.max(1, Math.round(spec.tile / period)) * period
}

// --- tile rendering --------------------------------------------------------

type Tile = { canvas: HTMLCanvasElement; tile: number }

const tileCache = new Map<string, Tile>()

// Render one pattern tile into a `sizePx`-square canvas. The spec's geometry is in CSS px; the
// context is pre-scaled so it fills the canvas exactly, whatever size the caller asked for (that is
// how a cell gets a whole number of tile rows — see paintHeatmapCell). Motifs are drawn wrapped
// across the tile edges so the repeat is seamless.
function renderTile(level: number, sizePx: number): Tile {
  const key = `${level}@${sizePx}`
  const cached = tileCache.get(key)
  if (cached) return cached

  const spec = HEATMAP_PATTERNS[level]
  const tile = specTile(spec)

  const canvas = document.createElement("canvas")
  canvas.width = sizePx
  canvas.height = sizePx
  const context = canvas.getContext("2d") as CanvasRenderingContext2D
  context.scale(sizePx / tile, sizePx / tile)

  const inverted = spec.kind === "lines" && spec.inverted === true
  context.fillStyle = inverted ? PATTERN_INK : PATTERN_BG
  context.fillRect(0, 0, tile, tile)
  const ink = inverted ? PATTERN_BG : PATTERN_INK

  if (spec.kind === "dots") {
    // Cluster centered in the tile, its dots stepping along `angleDeg`. Canvas y
    // grows downward, so negate the angle to keep 45° reading as "up-right".
    const radians = (-spec.angleDeg * Math.PI) / 180
    const ux = Math.cos(radians)
    const uy = Math.sin(radians)
    context.fillStyle = ink
    context.beginPath()
    for (let i = 0; i < spec.count; i++) {
      const step = i - (spec.count - 1) / 2
      const cx = tile / 2 + ux * spec.gap * step
      const cy = tile / 2 + uy * spec.gap * step
      // Wrapped copies so a cluster overflowing the tile reappears on the far side.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          context.moveTo(cx + dx * tile + spec.radius, cy + dy * tile)
          context.arc(cx + dx * tile, cy + dy * tile, spec.radius, 0, Math.PI * 2)
        }
      }
    }
    context.fill()
  } else {
    // Lines of the family rise·x + run·y = j·step. `step` is the requested perpendicular spacing
    // expressed in those units; because the tile is a whole number of periods, the value at every
    // tile corner is a multiple of it — which is exactly the condition for a seamless repeat.
    const { rise, run, length } = lineSlope(spec.angleDeg)
    const step = spec.spacing * length
    const corners = [0, rise * tile, run * tile, (rise + run) * tile]
    const first = Math.floor(Math.min(...corners) / step) - 1
    const last = Math.ceil(Math.max(...corners) / step) + 1
    // How far to extend each line from its base point to clear the tile in both directions.
    const reach = (2 * tile) / length

    context.strokeStyle = ink
    context.lineWidth = spec.width
    context.lineCap = "butt"
    context.beginPath()
    for (let j = first; j <= last; j++) {
      const offset = j * step
      // A point on the line: intercept it on whichever axis it actually crosses.
      const baseX = Math.abs(rise) >= Math.abs(run) ? offset / rise : 0
      const baseY = Math.abs(rise) >= Math.abs(run) ? 0 : offset / run
      context.moveTo(baseX + run * reach, baseY - rise * reach)
      context.lineTo(baseX - run * reach, baseY + rise * reach)
    }
    context.stroke()
  }

  const result = { canvas, tile }
  tileCache.set(key, result)
  return result
}

// CanvasPattern objects are cheap but context-scoped in spirit, so cache per context.
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>()

function getPattern(context: CanvasRenderingContext2D, level: number, sizePx: number) {
  let byKey = patternCache.get(context)
  if (!byKey) {
    byKey = new Map()
    patternCache.set(context, byKey)
  }
  const key = `${level}@${sizePx}`
  const cached = byKey.get(key)
  if (cached) return cached
  const pattern = context.createPattern(renderTile(level, sizePx).canvas, "repeat") as CanvasPattern
  byKey.set(key, pattern)
  return pattern
}

// Fit a whole number of tile rows into a cell `height` CSS px tall. Without this the last row of
// every cell is a clipped sliver — a 7px tile in a 9px row shows one row of dots plus a 2px band of
// the next one, which is what makes the repeat look broken.
//
// `sizePx` is the source canvas (integer device px, so it can be rasterized) and `tile` is the size
// it is drawn at (fractional, so rows × tile is exactly the cell height). They agree whenever the
// cell divides evenly — the usual retina case — and differ by a hair otherwise.
function fitTileToCell(level: number, height: number, dpr: number) {
  const target = height * dpr
  const rows = Math.max(1, Math.round(target / (specTile(HEATMAP_PATTERNS[level]) * dpr)))
  return { sizePx: Math.max(2, Math.round(target / rows)), tile: height / rows }
}

// --- painting --------------------------------------------------------------

// Fill one heatmap cell. `level` is a pattern level index, or null for an empty cell.
//
// `origin` is where the texture's tile grid starts. Every cell that shares an origin is a window
// onto one continuous field, so same-level neighbours join up instead of each restarting the pattern
// at its own edge — which matters because cell widths are data-driven and rarely whole tiles. Pass
// the row's left edge (constant x, the row's own y) and a run of equal cells reads as one texture.
// Omit it and each cell tiles from its own corner, self-contained.
//
// Vertically it always lines up: fitTileToCell puts a whole number of tile rows in every cell, so
// each row starts at the phase the row above ended on.
export function paintHeatmapCell(
  context: CanvasRenderingContext2D,
  level: number | null,
  x: number,
  y: number,
  width: number,
  height: number,
  origin?: { x: number; y: number },
) {
  if (level == null) {
    context.fillStyle = PATTERN_EMPTY
    context.fillRect(x, y, width, height)
    return
  }
  const clamped = Math.max(0, Math.min(HEATMAP_LEVEL_COUNT - 1, level))
  if (HEATMAP_ENCODING === "color") {
    context.fillStyle = HEATMAP_LEVEL_COLORS[clamped]
    context.fillRect(x, y, width, height)
    return
  }
  const dpr = window.devicePixelRatio || 1
  const { sizePx, tile } = fitTileToCell(clamped, height, dpr)
  const pattern = getPattern(context, clamped, sizePx)
  // Pattern space is the source canvas in device pixels; `scale` maps it onto the `tile` CSS px it
  // should occupy, and the translation sets where the tile grid starts.
  const scale = tile / sizePx
  pattern.setTransform({
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: origin?.x ?? x,
    f: origin?.y ?? y,
  })
  context.fillStyle = pattern
  context.fillRect(x, y, width, height)
}

// --- DOM swatches (legend, slider rail) ------------------------------------

const swatchCache = new Map<string, CSSProperties>()

// CSS background rendering one pattern level in plain DOM. `fitHeight` (the height of the element
// it will fill) makes the tile divide that height evenly, the same way cells are fitted.
export function patternSwatchStyle(level: number, fitHeight = 0): CSSProperties {
  const key = `${level}@${fitHeight}`
  const cached = swatchCache.get(key)
  if (cached) return cached
  if (HEATMAP_ENCODING === "color") {
    const style = { backgroundColor: HEATMAP_LEVEL_COLORS[level] } satisfies CSSProperties
    swatchCache.set(key, style)
    return style
  }
  const base = specTile(HEATMAP_PATTERNS[level])
  const tile = fitHeight > 0 ? fitHeight / Math.max(1, Math.round(fitHeight / base)) : base
  const { canvas } = renderTile(level, Math.max(2, Math.round(tile * 2))) // 2x for retina
  const style = {
    backgroundColor: PATTERN_BG,
    backgroundImage: `url(${canvas.toDataURL()})`,
    backgroundSize: `${tile}px ${tile}px`,
    backgroundRepeat: "repeat",
  } satisfies CSSProperties
  swatchCache.set(key, style)
  return style
}

// One swatch per level for the bucket slider's rail. Null in color mode, where the
// slider's existing color gradient is the better rendering.
export function getBucketSegmentStyles(fitHeight = 0): CSSProperties[] | null {
  if (HEATMAP_ENCODING === "color") return null
  return HEATMAP_PATTERNS.map((_, index) => patternSwatchStyle(index, fitHeight))
}
