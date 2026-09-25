import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Modal,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import {
  HEATMAP_BLOCKS,
  OVERVIEW_MIN_COL_PX,
  OVERVIEW_MIN_LABEL_PX,
  OVERVIEW_ROW_Z_LIMIT,
  OVERVIEW_SMD_CAP,
} from "./constants"
import {
  computeHeatmapDerived,
  divergingColor,
  getHeatmapHeaderLines,
  matchesHeatmapSearch,
} from "./utils/heatmapUtils"
import {
  bucketPatternLevel,
  getBucketSegmentStyles,
  heatmapPatternLevel,
  HEATMAP_LEVEL_COLORS,
  HEATMAP_LEVEL_COUNT,
  paintHeatmapCell,
} from "./utils/heatmapPatterns"
import PatternLegend from "./UI/PatternLegend"
import { buildHierarchyIndex } from "./utils/hierarchyUtils"
import type {
  ChartBlockKey,
  ConceptSummaryRow,
  HeatmapScaleMode,
  OverviewColorMetric,
} from "./types"
import { formatNumber } from "./utils/utils"
import MultiTrackColorSlider from "./UI/MultiTrackColorSlider"
import { Info, Restore, Search } from "@mui/icons-material"
import { useTheme } from "@mui/material/styles"

// Canvas geometry (CSS pixels). The overview is transposed: analyses are the (few, fixed) rows and
// concepts are the (many) columns. Columns follow the parentâ†’children hierarchy (buildHierarchyIndex):
// the top level is the tree roots; clicking a parent opens its direct children in a panel below â€” the
// stack of panels keeps the whole drill path on screen so you always know where you are.
const LABEL_WIDTH = 160 // left gutter for analysis row labels
// Top strip, split into two sub-bands: labels on top (~6-22px) and the affordance/child-count band
// at the foot (28-50px). Enlarged from 34 so the parent bars have room to grow without hitting labels.
const HEADER_WIDTH = 50
const ROW_HEIGHT = 30
const CANVAS_HEIGHT = HEADER_WIDTH + HEATMAP_BLOCKS.length * ROW_HEIGHT
const MIN_CANVAS_WIDTH = LABEL_WIDTH + 120
// Affordance band at the foot of the header strip. Parents draw a blue bar whose height encodes the
// number of direct children (sqrt-scaled per panel to the busiest parent); clicking one opens its
// children below. Leaves draw a thin gray tick and open the concept dialog. Always visible, even on
// 3px-wide columns.
const AFFORD_BAND_H = 15 // max bar height (a parent with the most children in its panel)
const AFFORD_MIN_BAR_H = 4 // min bar height so a single-child parent still reads as a bar
const LEAF_TICK_H = 3

// Per-row sort glyph in the label gutter: a fixed icon column near the gutter's right edge.
const SORT_ICON_RIGHT_PAD = 4
const SORT_ICON_W = 16

const VERTICAL_GUTTER = 0
const HORIZONTAL_GUTTER = 0

// Per-node rollup: MAX -log10(p) per block over the node's whole subtree (itself + all descendants),
// plus the subtree concept count and its strongest block (for sorting and the tooltip). `color` is
// the value the SD-effect color modes paint: per block, the subtree value furthest from zero, sign kept â€”
// the raw SD-standardized effect in capped mode (clamped only when painted, so the caption shows the true value) or
// the row z-score in row-scaled mode. All-null in p-value mode, which paints from `maxLogp`.
type SubtreeAgg = {
  maxLogp: (number | null)[]
  color: (number | null)[]
  bestScore: number
  count: number
}

// One drawn column: a concept node at a hierarchy level, shown via its subtree rollup.
type Column = {
  row: ConceptSummaryRow
  agg: SubtreeAgg
  hasChildren: boolean
  directChildCount: number
}

// Canvas-space box of a drawn column label, kept so the ones that open the concept dialog (leaves
// and the pinned label of the expanded column) can be hit-tested on click.
type LabelRect = { left: number; top: number; width: number; height: number }

// What a panel is sorted by: one of the analysis blocks (by the active color metric) or the
// direct-child count.
type SortKey = { type: "block"; block: ChartBlockKey } | { type: "children" }

// A column's rank value for one block under the active color metric: subtree -log10(p) in p-value
// mode, |SD effect| (or |z|) in the SD-effect modes. Magnitude, not the signed value, so the width cap keeps
// strong effects in both directions instead of dropping every strongly negative one.
function blockScore(agg: SubtreeAgg, block: number, metric: OverviewColorMetric) {
  if (metric === "pValue") return agg.maxLogp[block]
  const value = agg.color[block]
  return value == null ? null : Math.abs(value)
}

// Strongest block of a column under the active metric: the tiebreak when the sorted block is equal.
function overallScore(agg: SubtreeAgg, metric: OverviewColorMetric) {
  if (metric === "pValue") return agg.bestScore
  let best = 0
  for (let b = 0; b < agg.color.length; b++) best = Math.max(best, blockScore(agg, b, metric) ?? 0)
  return best
}

const EMPTY_AGG: SubtreeAgg = {
  maxLogp: new Array<number | null>(HEATMAP_BLOCKS.length).fill(null),
  color: new Array<number | null>(HEATMAP_BLOCKS.length).fill(null),
  bestScore: 0,
  count: 1,
}

// Size a canvas for the current devicePixelRatio (crisp text on retina) and reset its transform.
function prepareCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  const context = canvas.getContext("2d")
  if (context) context.scale(dpr, dpr)
  return context
}

// Trim text to fit maxWidth, appending an ellipsis when cut.
function truncateToWidth(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated.length > 1 && context.measureText(`${truncated}â€¦`).width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}â€¦`
}

// Saturation point of the diverging ramp per SD-effect mode: values at or beyond Â±limit get the full hue.
function colorLimit(metric: OverviewColorMetric) {
  return metric === "smdRowScaled" ? OVERVIEW_ROW_Z_LIMIT : OVERVIEW_SMD_CAP
}

const COLOR_METRIC_LABEL: Record<OverviewColorMetric, string> = {
  pValue: "max -log10(p)",
  smdCapped: "SD effect",
  smdRowScaled: "row-scaled SD effect",
}

const SORT_METRIC_LABEL: Record<OverviewColorMetric, string> = {
  pValue: "-log10(p)",
  smdCapped: "|SD effect|",
  smdRowScaled: "|z|",
}

function conceptLabel(row: ConceptSummaryRow) {
  return row.conceptName
    ? `${row.conceptName} | ${row.conceptCode}`
    : (row.conceptCode ?? String(row.conceptId))
}

// One hierarchy level as a transposed heatmap. Measures its own width, caps columns to what fits,
// and highlights the currently-expanded child (activeRowKey) so the link to the panel below is clear.
function OverviewLevel({
  title,
  columns,
  activeRowKey,
  colorMetric,
  scaleMode,
  perColumnMax,
  bucketBreakpoints,
  onPick,
  onOpenConcept,
}: {
  title: string
  columns: Column[]
  activeRowKey: string | null
  colorMetric: OverviewColorMetric
  scaleMode: HeatmapScaleMode
  perColumnMax: Record<ChartBlockKey, number>
  bucketBreakpoints: number[]
  onPick: (column: Column) => void
  onOpenConcept: (column: Column) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(MIN_CANVAS_WIDTH)
  const [hovered, setHovered] = useState<{
    column: number
    block: number
  } | null>(null)
  // Column index whose header label the pointer is over (-1 = none): underlines it and swaps the
  // caption hint, so the label being clickable is discoverable.
  const [hoveredLabel, setHoveredLabel] = useState(-1)
  // Boxes of the labels that open the concept dialog, keyed by column index and recorded by the
  // draw pass so clicks can hit-test them.
  const labelRectsRef = useRef(new Map<number, LabelRect>())
  // null = use the relevance default (so the default stays dynamic until the user picks a row).
  const [sort, setSort] = useState<{
    key: SortKey
    dir: "asc" | "desc"
  } | null>(null)

  // The canvas paints with plain strings, so every color has to be resolved from the theme by
  // hand. It must be the theme from *context* (useTheme), not the `appTheme` object: `appTheme
  // .palette` is the default color scheme frozen at createTheme() time, so reading it â€” at module
  // scope or inside a callback â€” always yields the light palette no matter what the toggle says.
  // ThemeProvider swaps what context holds; it does not mutate the object you imported.
  const theme = useTheme()
  const canvasColors = useMemo(() => {
    const isLight = theme.palette.mode === "light"
    return {
      canvasBg: theme.palette.background.paper,
      gutterBg: theme.palette.background.paper,
      gutterText: theme.palette.text.primary,
      emptyText: theme.palette.text.secondary,
      // Affordance band: parent bars in the app blue, leaf ticks in the faintest text tone.
      parentBar: theme.palette.primary.main,
      leafTick: theme.palette.text.disabled,
      sortActive: theme.palette.primary.main,
      sortInactive: theme.palette.text.disabled,
      labelBg: theme.palette.background.paper,
      // 12px canvas text over `paper` â€” the `main` step is too light to read against it, so labels
      // take the darker (light mode) / lighter (dark mode) end of the ramp.
      labelParent: isLight ? theme.palette.primary.dark : theme.palette.primary.light,
      labelLeaf: theme.palette.text.primary,
      // Expanded column: `secondary` (amber) so a persistent selection is a different hue from the
      // blue hover outline, not just a different shade of it.
      expanded: isLight ? theme.palette.secondary.dark : theme.palette.secondary.light,
      hover: theme.palette.primary.main,
    }
  }, [theme])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setCanvasWidth(Math.max(MIN_CANVAS_WIDTH, Math.floor(element.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Relevance default: the analysis with the highest summed score (-log10(p) or |SD effect|, following the
  // color metric) across this panel's columns.
  const relevanceBlock = useMemo(() => {
    let bestBlock = HEATMAP_BLOCKS[0]
    let bestSum = -1
    for (let b = 0; b < HEATMAP_BLOCKS.length; b++) {
      let sum = 0
      for (const column of columns) {
        const value = blockScore(column.agg, b, colorMetric)
        if (value != null) sum += value
      }
      if (sum > bestSum) {
        bestSum = sum
        bestBlock = HEATMAP_BLOCKS[b]
      }
    }
    return bestBlock
  }, [colorMetric, columns])

  const effectiveSort: { key: SortKey; dir: "asc" | "desc" } = sort ?? {
    key: { type: "block", block: relevanceBlock },
    dir: "desc",
  }
  const sortBlockIndex =
    effectiveSort.key.type === "block" ? HEATMAP_BLOCKS.indexOf(effectiveSort.key.block) : -1
  const sortByChildren = effectiveSort.key.type === "children"

  // Rank by the active dimension (desc, nulls last) so the width cap keeps the strongest columns;
  // ascending just reverses the kept set for display. Tiebreak by the column's strongest block under
  // the same metric, then name.
  const ranked = useMemo(() => {
    const overall = new Map(columns.map((c) => [c, overallScore(c.agg, colorMetric)] as const))
    const tiebreak = (a: Column, b: Column) =>
      (overall.get(b) ?? 0) - (overall.get(a) ?? 0) ||
      conceptLabel(a.row).localeCompare(conceptLabel(b.row))
    return [...columns].sort((a, b) => {
      if (sortByChildren) return b.directChildCount - a.directChildCount || tiebreak(a, b)
      const av = blockScore(a.agg, sortBlockIndex, colorMetric)
      const bv = blockScore(b.agg, sortBlockIndex, colorMetric)
      if (av == null && bv == null) return tiebreak(a, b)
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av || tiebreak(a, b)
    })
  }, [colorMetric, columns, sortBlockIndex, sortByChildren])

  const gridWidth = canvasWidth - LABEL_WIDTH
  const maxColumns = Math.max(1, Math.floor(gridWidth / OVERVIEW_MIN_COL_PX))
  const kept = ranked.length > maxColumns ? ranked.slice(0, maxColumns) : ranked
  const shown = effectiveSort.dir === "asc" ? [...kept].reverse() : kept
  const hiddenCount = columns.length - kept.length
  const columnWidth = shown.length > 0 ? gridWidth / shown.length : gridWidth
  const activeIndex = activeRowKey ? shown.findIndex((c) => c.row.rowKey === activeRowKey) : -1

  // Busiest parent in this level â€” the reference the sqrt-scaled child-count bars normalize against.
  // Over `columns` (not `shown`) so the scale is stable regardless of the width cap.
  const maxChildCount = useMemo(
    () => Math.max(1, ...columns.map((column) => column.directChildCount)),
    [columns],
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = prepareCanvas(canvas, canvasWidth, CANVAS_HEIGHT)
    if (!context) return
    const labelRects = new Map<number, LabelRect>()
    labelRectsRef.current = labelRects

    context.fillStyle = canvasColors.canvasBg
    context.fillRect(0, 0, canvasWidth, CANVAS_HEIGHT)
    context.font = "12px Hack, monospace"
    context.textBaseline = "middle"

    if (shown.length === 0) {
      context.fillStyle = canvasColors.emptyText
      context.textAlign = "left"
      context.fillText("No concepts at this level.", 12, HEADER_WIDTH + ROW_HEIGHT)
      return
    }

    const showAllLabels = columnWidth >= OVERVIEW_MIN_LABEL_PX
    const cellWidth = columnWidth > 4 ? columnWidth - VERTICAL_GUTTER : columnWidth

    // Cells + analysis row labels.
    for (let b = 0; b < HEATMAP_BLOCKS.length; b++) {
      const block = HEATMAP_BLOCKS[b]
      const y = HEADER_WIDTH + b * ROW_HEIGHT

      // Shared by every cell in the row: columns are data-width, so anchoring the texture to the
      // plot's left edge is what lets a run of same-level columns read as one continuous field
      // instead of restarting the pattern at each (fractional) column boundary.
      const textureOrigin = { x: LABEL_WIDTH, y }

      for (let i = 0; i < shown.length; i++) {
        const x = LABEL_WIDTH + i * columnWidth
        if (colorMetric !== "pValue") {
          const value = shown[i].agg.color[b]
          if (value == null) {
            paintHeatmapCell(context, null, x, y, cellWidth, ROW_HEIGHT - HORIZONTAL_GUTTER)
          } else {
            context.fillStyle = divergingColor(value / colorLimit(colorMetric))
            context.fillRect(x, y, cellWidth, ROW_HEIGHT - HORIZONTAL_GUTTER)
          }
          continue
        }
        const value = shown[i].agg.maxLogp[b]
        const level =
          scaleMode === "global"
            ? bucketPatternLevel(value, bucketBreakpoints)
            : heatmapPatternLevel(value, perColumnMax[block])
        paintHeatmapCell(
          context,
          level,
          x,
          y,
          cellWidth,
          ROW_HEIGHT - HORIZONTAL_GUTTER,
          textureOrigin,
        )
      }

      context.fillStyle = canvasColors.gutterBg
      context.fillRect(0, y, LABEL_WIDTH - HORIZONTAL_GUTTER, ROW_HEIGHT - VERTICAL_GUTTER)
      context.fillStyle = canvasColors.gutterText
      context.textAlign = "left"
      const lines = getHeatmapHeaderLines(block)
      lines.forEach((line, lineIndex) => {
        const lineY = lines.length === 1 ? y + ROW_HEIGHT / 2 : y + 9 + lineIndex * 13
        context.fillText(line, 10, lineY)
      })

      // Sort affordance: the active row shows its direction arrow; others a faint toggle hint.
      const isSortBlock = b === sortBlockIndex
      context.fillStyle = isSortBlock ? canvasColors.sortActive : canvasColors.sortInactive
      context.textAlign = "center"
      context.fillText(
        isSortBlock ? (effectiveSort.dir === "desc" ? "â–¼" : "â–²") : "â‡…",
        LABEL_WIDTH - SORT_ICON_RIGHT_PAD - SORT_ICON_W / 2,
        y + ROW_HEIGHT / 2,
      )
      context.textAlign = "left"
    }

    // Header strip: gutter caption + rotated concept labels (all when wide enough, else only hovered).
    context.fillStyle = canvasColors.gutterBg
    context.fillRect(0, 0, LABEL_WIDTH - HORIZONTAL_GUTTER, HEADER_WIDTH)
    context.fillStyle = canvasColors.gutterText
    context.textAlign = "left"
    context.fillText("Concept â†’", 10, HEADER_WIDTH / 2)

    // Child-count sort toggle, stacked in the sort-icon column above the per-analysis sort arrows.
    context.fillStyle = sortByChildren ? canvasColors.sortActive : canvasColors.sortInactive
    context.textAlign = "right"
    context.fillText("children", LABEL_WIDTH - SORT_ICON_RIGHT_PAD - SORT_ICON_W, HEADER_WIDTH / 2)
    context.textAlign = "center"
    context.fillText(
      sortByChildren ? (effectiveSort.dir === "desc" ? "â–¼" : "â–²") : "â‡…",
      LABEL_WIDTH - SORT_ICON_RIGHT_PAD - SORT_ICON_W / 2,
      HEADER_WIDTH / 2,
    )
    context.textAlign = "left"

    // Affordance band per column: parents draw a blue bar whose height (sqrt-scaled to the busiest
    // parent in this panel) encodes direct-child count; leaves draw a thin gray tick. Bars grow up
    // from the heatmap baseline so a taller bar = more direct children.
    for (let i = 0; i < shown.length; i++) {
      const x = LABEL_WIDTH + i * columnWidth
      if (shown[i].directChildCount > 0) {
        const barHeight =
          // AFFORD_MIN_BAR_H +
          (AFFORD_BAND_H - AFFORD_MIN_BAR_H) * Math.sqrt(shown[i].directChildCount / maxChildCount)
        context.fillStyle = canvasColors.parentBar
        context.fillRect(x, HEADER_WIDTH - barHeight, cellWidth, barHeight)
      } else {
        context.fillStyle = canvasColors.leafTick
        context.fillRect(x, HEADER_WIDTH - LEAF_TICK_H, cellWidth, LEAF_TICK_H)
      }
    }

    // Horizontal label centered over the column. Clamped to the canvas so edge columns stay fully
    // legible: a label that would spill past the left edge left-aligns, past the right edge right-aligns,
    // otherwise it stays centered. `maxWidth` caps it (per-column when showing all, full plot when hovered).
    const labelY = HEADER_WIDTH / 2
    const labelMinX = LABEL_WIDTH + 3
    const labelMaxX = canvasWidth - 3
    const drawColumnLabel = (
      index: number,
      color: string,
      maxWidth: number,
      withBackground: boolean,
      underline = false,
    ) => {
      const column = shown[index]
      if (!column) return
      const suffix = column.hasChildren ? " â–¸" : ""
      const text = truncateToWidth(context, conceptLabel(column.row) + suffix, maxWidth)
      const textWidth = context.measureText(text).width
      const centerX = LABEL_WIDTH + index * columnWidth + columnWidth / 2
      let align: CanvasTextAlign = "center"
      let x = centerX
      if (centerX - textWidth / 2 < labelMinX) {
        align = "left"
        x = labelMinX
      } else if (centerX + textWidth / 2 > labelMaxX) {
        align = "right"
        x = labelMaxX
      }
      const left = align === "left" ? x : align === "right" ? x - textWidth : x - textWidth / 2
      if (withBackground) {
        context.fillStyle = canvasColors.labelBg
        context.fillRect(left - 3, labelY - 8, textWidth + 6, 16)
      }
      context.fillStyle = color
      context.textAlign = align
      context.textBaseline = "middle"
      context.fillText(text, x, labelY)
      context.textAlign = "left"
      if (underline) context.fillRect(left, labelY + 7, textWidth, 1)
      return {
        left: left - 3,
        top: labelY - 8,
        width: textWidth + 6,
        height: 16,
      } satisfies LabelRect
    }

    // When columns are wide enough, label every one (kept inside its own column so they don't collide).
    // A leaf's label is a hit target for the concept dialog â€” the same thing its column does â€” so its
    // box is recorded; a parent's label is not (its column drills into the panel below instead).
    if (showAllLabels) {
      for (let i = 0; i < shown.length; i++) {
        const rect = drawColumnLabel(
          i,
          shown[i].hasChildren ? canvasColors.labelParent : canvasColors.labelLeaf,
          columnWidth - 6,
          false,
          hoveredLabel === i,
        )
        if (rect && !shown[i].hasChildren) labelRects.set(i, rect)
      }
    }

    // Persistent highlight for the expanded column (its children are the panel below).
    if (activeIndex >= 0) {
      const x = LABEL_WIDTH + activeIndex * columnWidth
      context.fillStyle = canvasColors.expanded
      context.fillRect(x, 0, Math.max(cellWidth, 2), 4)
      context.strokeStyle = canvasColors.expanded
      context.lineWidth = 2
      context.strokeRect(
        x + 1,
        HEADER_WIDTH + 1,
        Math.max(cellWidth - HORIZONTAL_GUTTER, 2),
        HEATMAP_BLOCKS.length * ROW_HEIGHT - 2,
      )
      // The pinned label doubles as a hit target: clicking it opens the concept dialog, while
      // clicking the column itself only toggles the child panel below.
      const labelRect = drawColumnLabel(
        activeIndex,
        canvasColors.expanded,
        labelMaxX - labelMinX,
        true,
        hoveredLabel === activeIndex,
      )
      if (labelRect) labelRects.set(activeIndex, labelRect)
    }

    // Hover highlight: outline the hovered column across all rows, and always label it.
    if (hovered && shown[hovered.column]) {
      const x = LABEL_WIDTH + hovered.column * columnWidth
      context.strokeStyle = canvasColors.hover
      context.lineWidth = 1.5
      context.strokeRect(
        x + 0.5,
        HEADER_WIDTH + 0.5,
        Math.max(cellWidth, 2),
        HEATMAP_BLOCKS.length * ROW_HEIGHT - VERTICAL_GUTTER,
      )
      drawColumnLabel(hovered.column, canvasColors.hover, labelMaxX - labelMinX, true)
    }
  }, [
    activeIndex,
    bucketBreakpoints,
    canvasWidth,
    colorMetric,
    columnWidth,
    effectiveSort.dir,
    hovered,
    hoveredLabel,
    maxChildCount,
    perColumnMax,
    scaleMode,
    shown,
    sortBlockIndex,
    sortByChildren,
    canvasColors,
  ])

  useEffect(() => {
    draw()
  }, [draw])

  const resolveCell = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x < LABEL_WIDTH || y < HEADER_WIDTH) return null
    const column = Math.floor((x - LABEL_WIDTH) / columnWidth)
    const block = Math.floor((y - HEADER_WIDTH) / ROW_HEIGHT)
    if (column < 0 || column >= shown.length) return null
    if (block < 0 || block >= HEATMAP_BLOCKS.length) return null
    return { column, block }
  }

  // Hit-test the sort-icon column in the gutter; returns the analysis row index, or null.
  const resolveGutterSort = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const iconCenter = LABEL_WIDTH - SORT_ICON_RIGHT_PAD - SORT_ICON_W / 2
    if (x < iconCenter - SORT_ICON_W / 2 || x > iconCenter + SORT_ICON_W / 2) return null
    if (y < HEADER_WIDTH) return null
    const block = Math.floor((y - HEADER_WIDTH) / ROW_HEIGHT)
    if (block < 0 || block >= HEATMAP_BLOCKS.length) return null
    return block
  }

  // Hit-test the dialog-opening labels (leaves + the pinned one) against the boxes the last paint
  // recorded. Returns the column index, or -1.
  const resolveLabel = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return -1
    const bounds = canvas.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const rects = labelRectsRef.current
    const hits = (rect: LabelRect | undefined) =>
      rect != null &&
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    // Painted last wins: the pinned label is drawn over the per-column ones it overlaps.
    if (activeIndex >= 0 && hits(rects.get(activeIndex))) return activeIndex
    for (const [index, rect] of rects) if (hits(rect)) return index
    return -1
  }

  // Hit-test the child-count sort toggle (caption + glyph) in the header row of the gutter.
  const resolveHeaderSort = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (y < 0 || y >= HEADER_WIDTH) return false
    return (
      x >= LABEL_WIDTH - SORT_ICON_RIGHT_PAD - SORT_ICON_W - 60 &&
      x <= LABEL_WIDTH - SORT_ICON_RIGHT_PAD
    )
  }

  const sameSortKey = (a: SortKey, b: SortKey) =>
    a.type === "children" ? b.type === "children" : b.type === "block" && a.block === b.block

  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      const active = current ?? {
        key: { type: "block", block: relevanceBlock } as SortKey,
        dir: "desc" as const,
      }
      if (sameSortKey(active.key, key)) {
        return { key, dir: active.dir === "desc" ? "asc" : "desc" }
      }
      return { key, dir: "desc" }
    })
  }

  const hoveredLabelColumn = hoveredLabel >= 0 ? (shown[hoveredLabel] ?? null) : null
  const hoveredColumn = hovered ? shown[hovered.column] : null
  const hoveredBlock = hovered ? HEATMAP_BLOCKS[hovered.block] : null
  const hoveredValue = hovered && hoveredColumn ? hoveredColumn.agg.maxLogp[hovered.block] : null
  const hoveredColor = hovered && hoveredColumn ? hoveredColumn.agg.color[hovered.block] : null

  return (
    <Paper sx={{ p: 1.5 }} variant="outlined">
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "baseline",
          justifyContent: "space-between",
          mb: 0.5,
        }}
      >
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {shown.length.toLocaleString()} of {columns.length.toLocaleString()}
          {hiddenCount > 0 ? ` Â· ${hiddenCount.toLocaleString()} weaker hidden` : ""}
          {` Â· sorted by ${
            effectiveSort.key.type === "children"
              ? "children"
              : `${effectiveSort.key.block} ${SORT_METRIC_LABEL[colorMetric]}`
          } ${effectiveSort.dir === "desc" ? "â–¼" : "â–²"}`}
        </Typography>
      </Stack>
      <Box ref={containerRef} sx={{ width: "100%", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", cursor: "pointer" }}
          onMouseMove={(event) => {
            setHoveredLabel(resolveLabel(event))
            setHovered(resolveCell(event))
          }}
          onMouseLeave={() => {
            setHovered(null)
            setHoveredLabel(-1)
          }}
          onClick={(event) => {
            const labelHit = resolveLabel(event)
            if (labelHit >= 0) {
              onOpenConcept(shown[labelHit])
              return
            }
            if (resolveHeaderSort(event)) {
              toggleSort({ type: "children" })
              return
            }
            const sortHit = resolveGutterSort(event)
            if (sortHit != null) {
              toggleSort({ type: "block", block: HEATMAP_BLOCKS[sortHit] })
              return
            }
            const cell = resolveCell(event)
            const column = cell ? shown[cell.column] : null
            if (column) onPick(column)
          }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {hoveredLabelColumn ? (
          <>
            <strong>{conceptLabel(hoveredLabelColumn.row)}</strong>
            {" | click the name to open the concept dialog"}
          </>
        ) : hoveredColumn && hoveredBlock ? (
          <>
            <strong>{conceptLabel(hoveredColumn.row)}</strong>
            {/* {hoveredColumn.row.conceptCode ? ` | ${hoveredColumn.row.conceptCode}` : ""} */}
            {hoveredColumn.directChildCount > 0
              ? ` | ${hoveredColumn.directChildCount.toLocaleString()} direct children Â· ${hoveredColumn.agg.count.toLocaleString()} in subtree â€” click to open below`
              : " | leaf â€” click to open in the table"}
            {` | ${hoveredBlock} | max -log10(p) ${hoveredValue == null ? "N/A" : formatNumber(hoveredValue, 2)}`}
            {colorMetric !== "pValue" &&
              ` | ${COLOR_METRIC_LABEL[colorMetric]} ${hoveredColor == null ? "N/A" : formatNumber(hoveredColor, 2)}`}
          </>
        ) : (
          "Hover a column to inspect the concept and subtree evidence."
        )}
      </Typography>
    </Paper>
  )
}

// Rail height for the bucket slider. Also what the texture swatches are fitted to, so each bucket
// shows a whole number of tile rows.
const BUCKET_RAIL_HEIGHT = 16

function ColorRangeSlider({
  value,
  onChange,
  max,
  colors,
  resetBreakpoints,
}: {
  value: number[]
  onChange: (value: number[]) => void
  max: number
  colors: string[]
  resetBreakpoints: () => void
}) {
  return (
    <Box sx={{ px: 1 }}>
      <MultiTrackColorSlider
        value={value}
        onChange={onChange}
        colors={colors}
        // Rail buckets rendered with the same textures the cells use.
        segmentStyles={getBucketSegmentStyles(BUCKET_RAIL_HEIGHT)}
        segmentHeight={BUCKET_RAIL_HEIGHT}
        max={max}
        marks={[
          { value: 0, label: "0" },
          // A mark under each handle so its threshold value is always visible (not just on hover).
          ...value.map((breakpoint) => ({
            value: breakpoint,
            label: breakpoint.toFixed(1),
          })),
          { value: max, label: formatNumber(max, 0) },
        ]}
      />
      <Typography variant="caption">-Log(p) buckets (drag to set thresholds)</Typography>
      <Button size="small" startIcon={<Restore />} onClick={resetBreakpoints} />
    </Box>
  )
}

// Key for the SD-effect color modes: the diverging ramp from -limit to +limit.
function DivergingLegend({ metric }: { metric: OverviewColorMetric }) {
  const limit = colorLimit(metric)
  const stops = Array.from({ length: 11 }, (_, index) => divergingColor(index / 5 - 1))
  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Box
        sx={{
          height: 12,
          borderRadius: 0.5,
          background: `linear-gradient(to right, ${stops.join(", ")})`,
        }}
      />
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="caption">â‰¤ âˆ’{limit}</Typography>
        <Typography variant="caption">0</Typography>
        <Typography variant="caption">â‰¥ {limit}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {metric === "smdRowScaled"
          ? `SD-standardized effect z-scored per analysis row: (SD effect - row mean) / row SD, saturating at +/-${limit}`
          : `SD-standardized effect capped at Â±${limit}`}
      </Typography>
    </Box>
  )
}

function InfoModal() {
  const [open, setOpen] = useState(false)
  const handleOpen = () => setOpen(true)
  const handleClose = () => setOpen(false)

  const style = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 400,
    bgcolor: "background.paper",
    boxShadow: 24,
    p: 4,
    borderRadius: 2,
  }

  return (
    <Box>
      <Button onClick={handleOpen} startIcon={<Info />} variant="outlined" size="small">
        About
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box sx={style}>
          <Typography
            variant="body2"
            color="text.secondary"
            component="div"
            sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          >
            Each column is a concept. With <b>Color by: p-value</b> its texture shows the strongest
            -log10(p) evidence across that concept and all of its descendants â€” the denser the
            pattern, the stronger the evidence. With the <b>SD effect</b> options the cell shows the
            SD-standardized effect furthest from zero in that subtree (blue = lower in cases,
            red = higher), either capped at Â±{OVERVIEW_SMD_CAP} or z-scored within each analysis
            row. The bar under each column header shows what a click does â€” and, for parents, how
            many direct children it has:
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                mx: 0.75,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 14,
                  height: 14,
                  bgcolor: "primary.main",
                  borderRadius: 0.5,
                  display: "inline-block",
                }}
              />
              parent â†’ opens its children in a panel below. Bar height = number of direct children
              (scaled to the busiest parent in that level).
            </Box>
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                mx: 0.75,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 14,
                  height: 6,
                  bgcolor: "text.disabled",
                  borderRadius: 0.5,
                  display: "inline-block",
                }}
              />
              leaf â†’ opens the concept dialog.
            </Box>
            <Box>The currently expanded column is outlined in amber.</Box>
            <Box>
              When the scale is set to <b>Global</b> you can use the slider to adjust the thresholds
              at which each texture level kicks in.
            </Box>
            <PatternLegend />
          </Typography>
        </Box>
      </Modal>
    </Box>
  )
}

export function DuckDbOverview({
  rows,
  chartLoading,
  onSelectConcept,
  sharedControls,
}: {
  rows: ConceptSummaryRow[]
  chartLoading: boolean
  onSelectConcept: (rowKey: string) => void
  sharedControls: ReactNode
}) {
  const [colorMetric, setColorMetric] = useState<OverviewColorMetric>("smdCapped")
  const [scaleMode, setScaleMode] = useState<HeatmapScaleMode>("perColumn")
  const [searchText, setSearchText] = useState("")
  // Drill path of parent rowKeys. Empty = only the roots panel. Each entry adds a child panel below.
  const [path, setPath] = useState<string[]>([])
  // Breakpoints (in -log10 value units) for the global bucketed scale: one bucket per texture level,
  // so HEATMAP_LEVEL_COUNT - 1 thumbs.
  const [breakpoints, setBreakpoints] = useState<number[]>([])

  const { perColumnMax, globalMax, derivedByKey, smdRowStats } = useMemo(
    () => computeHeatmapDerived(rows),
    [rows],
  )

  // The concept population for the overview: search-filtered. The hierarchy is rebuilt from this set,
  // so a filtered-out parent re-links its children to the nearest surviving ancestor (same as the table).
  const population = useMemo(
    () => rows.filter((row) => matchesHeatmapSearch(row, searchText)),
    [rows, searchText],
  )

  const rowByKey = useMemo(
    () => new Map(population.map((row) => [row.rowKey, row] as const)),
    [population],
  )

  // Same parentâ†’children logic the table uses (rootRowKeys + childRowKeysByParentRowKey).
  const hierarchy = useMemo(() => buildHierarchyIndex(population), [population])

  // Subtree rollups: MAX -log10(p) per block across each node's whole subtree. Post-order over the
  // hierarchy, memoized per node, with a cycle guard. O(nodes); recomputed only when data changes.
  const subtreeAggByKey = useMemo(() => {
    const blockCount = HEATMAP_BLOCKS.length
    const agg = new Map<string, SubtreeAgg>()
    const visiting = new Set<string>()
    const compute = (rowKey: string): SubtreeAgg => {
      const cached = agg.get(rowKey)
      if (cached) return cached
      const derived = derivedByKey.get(rowKey)
      const maxLogp: (number | null)[] = derived
        ? [...derived.logp]
        : new Array<number | null>(blockCount).fill(null)
      // Row scaling uses the stats of the whole loaded population (not the search subset or one
      // panel), so a concept keeps its color while you search or drill.
      const color: (number | null)[] = HEATMAP_BLOCKS.map((_, b) => {
        const smd = derived?.smd[b] ?? null
        if (smd == null || colorMetric === "pValue") return null
        if (colorMetric === "smdCapped") return smd
        const { mean, sd } = smdRowStats[b]
        return sd > 0 ? (smd - mean) / sd : 0
      })
      let count = 1
      if (!visiting.has(rowKey)) {
        visiting.add(rowKey)
        for (const childKey of hierarchy.childRowKeysByParentRowKey.get(rowKey) ?? []) {
          if (childKey === rowKey) continue
          const childAgg = compute(childKey)
          count += childAgg.count
          for (let b = 0; b < blockCount; b++) {
            const value = childAgg.maxLogp[b]
            if (value != null && (maxLogp[b] == null || value > (maxLogp[b] as number))) {
              maxLogp[b] = value
            }
            const childColor = childAgg.color[b]
            const own = color[b]
            if (childColor != null && (own == null || Math.abs(childColor) > Math.abs(own))) {
              color[b] = childColor
            }
          }
        }
        visiting.delete(rowKey)
      }
      let bestScore = 0
      for (const value of maxLogp) if (value != null && value > bestScore) bestScore = value
      const result: SubtreeAgg = { maxLogp, color, bestScore, count }
      agg.set(rowKey, result)
      return result
    }
    for (const rowKey of rowByKey.keys()) compute(rowKey)
    return agg
  }, [colorMetric, derivedByKey, hierarchy, rowByKey, smdRowStats])

  // Reset the drill path when the population changes (new data or search). Done during render â€”
  // React's recommended alternative to a setState-in-effect.
  const [prevPopulation, setPrevPopulation] = useState(population)
  if (prevPopulation !== population) {
    setPrevPopulation(population)
    setPath([])
  }

  // Reset the global scale's breakpoints to equal steps whenever the value range changes (new
  // data/scope). Also render-time, mirroring the path reset above.
  const [prevGlobalMax, setPrevGlobalMax] = useState<number | null>(null)
  if (prevGlobalMax !== globalMax) {
    resetBreakpoints()
  }

  function resetBreakpoints() {
    setPrevGlobalMax(globalMax)
    setBreakpoints(
      Array.from(
        { length: HEATMAP_LEVEL_COUNT - 1 },
        (_, index) => (globalMax * (index + 1)) / HEATMAP_LEVEL_COUNT,
      ),
    )
  }

  // One entry per visible panel: the roots, then one panel per drilled parent in `path`. Columns are the
  // level's nodes in hierarchy order; each OverviewLevel sorts (by its chosen analysis) and caps them.
  const levels = useMemo(() => {
    const makeColumns = (keys: string[]): Column[] =>
      keys
        .map((rowKey) => {
          const row = rowByKey.get(rowKey)
          if (!row) return null
          const agg = subtreeAggByKey.get(rowKey) ?? EMPTY_AGG
          const directChildCount = hierarchy.childRowKeysByParentRowKey.get(rowKey)?.length ?? 0
          const hasChildren = directChildCount > 0
          return { row, agg, hasChildren, directChildCount } satisfies Column
        })
        .filter((column): column is Column => column != null)

    const rootKeys =
      hierarchy.rootRowKeys.length > 0 ? hierarchy.rootRowKeys : population.map((row) => row.rowKey)
    const result: { parentRow: ConceptSummaryRow | null; columns: Column[] }[] = [
      { parentRow: null, columns: makeColumns(rootKeys) },
    ]
    for (let d = 0; d < path.length; d++) {
      const childKeys = hierarchy.childRowKeysByParentRowKey.get(path[d]) ?? []
      if (childKeys.length === 0) break
      result.push({
        parentRow: rowByKey.get(path[d]) ?? null,
        columns: makeColumns(childKeys),
      })
    }
    return result
  }, [hierarchy, path, population, rowByKey, subtreeAggByKey])

  // Click a parent â†’ open its children in the panel below (or collapse if already open). Leaf â†’ table.
  const handlePick = (depth: number, column: Column) => {
    if (column.hasChildren) {
      setPath((current) =>
        current[depth] === column.row.rowKey
          ? current.slice(0, depth)
          : [...current.slice(0, depth), column.row.rowKey],
      )
    } else {
      onSelectConcept(column.row.rowKey)
    }
  }

  return (
    <Stack spacing={2}>
      <Grid container spacing={2} sx={{ p: 1, pt: 2, placeContent: "space-between" }}>
        {sharedControls}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-overview-color-label">Color by</InputLabel>
            <Select
              labelId="duckdb-overview-color-label"
              value={colorMetric}
              label="Color by"
              onChange={(event) => setColorMetric(event.target.value as OverviewColorMetric)}
            >
              <MenuItem value="smdCapped">SD effect (capped Â±{OVERVIEW_SMD_CAP})</MenuItem>
              <MenuItem value="smdRowScaled">SD effect (row-scaled)</MenuItem>
              <MenuItem value="pValue">p-value (-log10)</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        {colorMetric === "pValue" && (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <FormControl fullWidth size={"small"}>
              <InputLabel id="duckdb-overview-scale-label">Color Scale</InputLabel>
              <Select
                labelId="duckdb-overview-scale-label"
                value={scaleMode}
                label="Color Scale"
                onChange={(event) => setScaleMode(event.target.value as HeatmapScaleMode)}
              >
                <MenuItem value="perColumn">Per analysis</MenuItem>
                <MenuItem value="global">Global</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        )}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size={"small"}
            label={
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                <Search sx={{ fontSize: 16 }} />
                Concept search
              </Box>
            }
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Filter the concept population by concept/code/id"
          />
        </Grid>
        <Grid columns={2} size={{ xs: 12, sm: 6 }}>
          {colorMetric !== "pValue" ? (
            <DivergingLegend metric={colorMetric} />
          ) : scaleMode === "global" ? (
            <ColorRangeSlider
              value={breakpoints}
              onChange={setBreakpoints}
              max={globalMax}
              colors={HEATMAP_LEVEL_COLORS}
              resetBreakpoints={resetBreakpoints}
            />
          ) : (
            // Per-analysis mode has no thresholds to drag â€” just the texture key.
            <Box sx={{ px: 1, pt: 1 }}>
              <PatternLegend />
            </Box>
          )}
        </Grid>
        <InfoModal />
      </Grid>

      <Stack spacing={1.5} sx={{ px: 1 }}>
        {chartLoading && <Alert severity="info">Loading chart concepts from DuckDB...</Alert>}

        <Breadcrumbs aria-label="hierarchy path">
          <Link
            component="button"
            type="button"
            underline="hover"
            color={path.length === 0 ? "text.primary" : "primary"}
            onClick={() => setPath([])}
          >
            All roots
          </Link>
          {path.map((rowKey, index) => {
            const isLast = index === path.length - 1
            const label = conceptLabel(
              rowByKey.get(rowKey) ?? ({ conceptId: 0, conceptName: rowKey } as ConceptSummaryRow),
            )
            return isLast ? (
              <Typography key={rowKey} color="text.primary">
                {label}
              </Typography>
            ) : (
              <Link
                key={rowKey}
                component="button"
                type="button"
                underline="hover"
                color="primary"
                onClick={() => setPath((current) => current.slice(0, index + 1))}
              >
                {label}
              </Link>
            )
          })}
        </Breadcrumbs>
      </Stack>

      <Stack spacing={1.5} sx={{ px: 1 }}>
        {levels.map((level, depth) => (
          <OverviewLevel
            key={depth === 0 ? "roots" : path[depth - 1]}
            title={
              depth === 0
                ? "Roots"
                : `Children of ${conceptLabel(level.parentRow ?? ({ conceptId: 0 } as ConceptSummaryRow))}`
            }
            columns={level.columns}
            activeRowKey={path[depth] ?? null}
            colorMetric={colorMetric}
            scaleMode={scaleMode}
            perColumnMax={perColumnMax}
            bucketBreakpoints={breakpoints}
            onPick={(column) => handlePick(depth, column)}
            onOpenConcept={(column) => onSelectConcept(column.row.rowKey)}
          />
        ))}
      </Stack>
    </Stack>
  )
}
