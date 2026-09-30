import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  Alert,
  Box,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { COLUMNS } from "../../utils/constants"
import { HEATMAP_BLOCKS, HEATMAP_MAX_CLUSTER_ROWS } from "./constants"
import {
  clusterHeatmapRows,
  computeHeatmapDerived,
  getBestHeatmapScore,
  getChartMetricValue,
  getHeatmapHeaderLines,
  getRepeatEvidenceCount,
  getRepeatEvidenceCountFromLogp,
  matchesHeatmapSearch,
} from "./utils/heatmapUtils"
import { heatmapPatternLevel, paintHeatmapCell } from "./utils/heatmapPatterns"
import PatternLegend from "./UI/PatternLegend"
import type {
  ChartBlockKey,
  ConceptSummaryRow,
  HeatmapCell,
  HeatmapOrderMode,
  HeatmapScaleMode,
} from "./types"
import { formatNumber } from "./utils/utils"

// Canvas geometry (CSS pixels).
const ROW_HEIGHT = 10
const HEADER_HEIGHT = 36
const LABEL_WIDTH = 250
const REPEAT_WIDTH = 42
const COLUMN_WIDTH = 108
const CANVAS_WIDTH = LABEL_WIDTH + REPEAT_WIDTH + HEATMAP_BLOCKS.length * COLUMN_WIDTH
// Visible canvas height; the row list scrolls within this window via virtualization.
const VIEWPORT_MAX = 560
// Extra rows drawn above/below the viewport so fast scrolling never reveals blank gaps.
const OVERSCAN = 6

// Size a canvas for the current devicePixelRatio (crisp text on retina) and reset its transform.
// Setting canvas.width also clears it, which is what we want before every redraw.
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

export function DuckDbHeatmap({
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
  const [heatmapOrderMode, setHeatmapOrderMode] = useState<HeatmapOrderMode>("repeatEvidence")
  const [heatmapScaleMode, setHeatmapScaleMode] = useState<HeatmapScaleMode>("perColumn")
  const [heatmapOrderBlock, setHeatmapOrderBlock] = useState<ChartBlockKey>("Binary")
  const [repeatThreshold, setRepeatThreshold] = useState(5)
  const [heatmapSearchText, setHeatmapSearchText] = useState("")
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // All per-row metrics + column/global maxima, computed once per data change (no per-row recompute
  // during sort/draw, no stack-overflowing spreads).
  const { perColumnMax, globalMax, derivedByKey } = useMemo(
    () => computeHeatmapDerived(rows),
    [rows],
  )

  const heatmapBaseRows = useMemo(
    () => rows.filter((row) => matchesHeatmapSearch(row, heatmapSearchText)),
    [heatmapSearchText, rows],
  )
  const heatmapRows = useMemo(() => {
    const sorted = [...heatmapBaseRows]
    const scoreOf = (row: ConceptSummaryRow) => derivedByKey.get(row.rowKey)?.bestScore ?? 0
    switch (heatmapOrderMode) {
      case "selectedBlock": {
        const blockIndex = HEATMAP_BLOCKS.indexOf(heatmapOrderBlock)
        const blockValue = (row: ConceptSummaryRow) =>
          derivedByKey.get(row.rowKey)?.logp[blockIndex] ?? 0
        return sorted.sort((a, b) => blockValue(b) - blockValue(a))
      }
      case "repeatEvidence": {
        const repeatOf = (row: ConceptSummaryRow) =>
          getRepeatEvidenceCountFromLogp(derivedByKey.get(row.rowKey)?.logp ?? [], repeatThreshold)
        return sorted.sort((a, b) => {
          const repeatDiff = repeatOf(b) - repeatOf(a)
          if (repeatDiff !== 0) return repeatDiff
          return scoreOf(b) - scoreOf(a)
        })
      }
      case "clustered":
        return clusterHeatmapRows(sorted, derivedByKey, HEATMAP_MAX_CLUSTER_ROWS)
      case "strongest":
      default:
        return sorted.sort((a, b) => scoreOf(b) - scoreOf(a))
    }
  }, [derivedByKey, heatmapBaseRows, heatmapOrderBlock, heatmapOrderMode, repeatThreshold])

  const rowIndexByKey = useMemo(() => {
    const index = new Map<string, number>()
    heatmapRows.forEach((row, position) => index.set(row.rowKey, position))
    return index
  }, [heatmapRows])

  const contentHeight = HEADER_HEIGHT + heatmapRows.length * ROW_HEIGHT
  const viewportHeight = Math.min(VIEWPORT_MAX, contentHeight)

  // Reset scroll to the top when the row set is reordered or refiltered, so the user isn't left
  // staring at an offset that now points at unrelated concepts. Not on scale (recolor only).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [heatmapOrderMode, heatmapOrderBlock, heatmapSearchText, repeatThreshold])

  // The draw function closes over current state. It's mirrored into a ref (below) so the
  // mount-only scroll listener always invokes the latest version without re-binding.
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = prepareCanvas(canvas, CANVAS_WIDTH, viewportHeight)
    if (!context) return
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    const hoveredIndex = hoveredCell ? rowIndexByKey.get(hoveredCell.row.rowKey) : undefined

    context.fillStyle = "#edf2f7"
    context.fillRect(0, 0, CANVAS_WIDTH, viewportHeight)
    context.font = "11px Hack, monospace"
    context.textBaseline = "middle"

    // Body - only the rows intersecting the viewport (+overscan), clipped below the header.
    context.save()
    context.beginPath()
    context.rect(0, HEADER_HEIGHT, CANVAS_WIDTH, Math.max(0, viewportHeight - HEADER_HEIGHT))
    context.clip()
    const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const lastRow = Math.min(
      heatmapRows.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    )
    for (let rowIndex = firstRow; rowIndex < lastRow; rowIndex++) {
      const row = heatmapRows[rowIndex]
      const derived = derivedByKey.get(row.rowKey)
      const y = HEADER_HEIGHT + rowIndex * ROW_HEIGHT - scrollTop
      const label = row.conceptName
        ? `${row.conceptName} (${row.conceptCode ?? row.conceptId})`
        : String(row.conceptId)
      const repeatCount = derived
        ? getRepeatEvidenceCountFromLogp(derived.logp, repeatThreshold)
        : 0

      context.fillStyle = rowIndex === hoveredIndex ? "#f0f4ff" : "#ffffff"
      context.fillRect(0, y, LABEL_WIDTH, ROW_HEIGHT - 1)
      context.fillStyle = "#222"
      context.textAlign = "left"
      context.fillText(label.slice(0, 34), 8, y + ROW_HEIGHT / 2)

      context.fillStyle = rowIndex === hoveredIndex ? "#f0f4ff" : "#ffffff"
      context.fillRect(LABEL_WIDTH, y, REPEAT_WIDTH - 1, ROW_HEIGHT - 1)
      context.fillStyle = repeatCount > 1 ? "#0d47a1" : "#666666"
      context.textAlign = "center"
      context.fillText(String(repeatCount), LABEL_WIDTH + REPEAT_WIDTH / 2, y + ROW_HEIGHT / 2)

      // One tile grid per row, starting at the plot's left edge, so cells line up across blocks.
      const textureOrigin = { x: LABEL_WIDTH + REPEAT_WIDTH, y }

      for (let blockIndex = 0; blockIndex < HEATMAP_BLOCKS.length; blockIndex++) {
        const value = derived ? derived.logp[blockIndex] : null
        const scaleMax =
          heatmapScaleMode === "perColumn" ? perColumnMax[HEATMAP_BLOCKS[blockIndex]] : globalMax
        paintHeatmapCell(
          context,
          heatmapPatternLevel(value, scaleMax),
          LABEL_WIDTH + REPEAT_WIDTH + blockIndex * COLUMN_WIDTH,
          y,
          COLUMN_WIDTH - 1,
          ROW_HEIGHT - 1,
          textureOrigin,
        )
      }
    }
    if (heatmapRows.length === 0) {
      context.fillStyle = "#888"
      context.textAlign = "left"
      context.fillText("No concepts match the current filters.", 8, HEADER_HEIGHT + ROW_HEIGHT * 2)
    }
    context.restore()

    // Header (drawn after the clipped body so it stays pinned at the top).
    context.fillStyle = "#f3f3f3"
    context.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT)
    context.fillStyle = "#222"
    context.textAlign = "left"
    context.fillText("Concept", 8, HEADER_HEIGHT / 2)

    context.fillStyle = "#f3f3f3"
    context.fillRect(LABEL_WIDTH, 0, REPEAT_WIDTH, HEADER_HEIGHT)
    context.fillStyle = "#222"
    context.textAlign = "center"
    context.fillText("Rep", LABEL_WIDTH + REPEAT_WIDTH / 2, HEADER_HEIGHT / 2)

    HEATMAP_BLOCKS.forEach((block, blockIndex) => {
      const x = LABEL_WIDTH + REPEAT_WIDTH + blockIndex * COLUMN_WIDTH
      context.fillStyle = "#f3f3f3"
      context.fillRect(x, 0, COLUMN_WIDTH, HEADER_HEIGHT)
      context.fillStyle = "#222"
      context.textAlign = "center"
      const headerLines = getHeatmapHeaderLines(block)
      headerLines.forEach((line, lineIndex) => {
        const y = headerLines.length === 1 ? HEADER_HEIGHT / 2 : 12 + lineIndex * 12
        context.fillText(line, x + COLUMN_WIDTH / 2, y)
      })
    })
  }, [
    derivedByKey,
    globalMax,
    heatmapRows,
    heatmapScaleMode,
    hoveredCell,
    perColumnMax,
    repeatThreshold,
    rowIndexByKey,
    viewportHeight,
  ])

  // Mirror the latest draw into a ref for the mount-only scroll listener, and repaint whenever the
  // pixel-affecting inputs change. Cost is O(visible rows), so even hover repaints are cheap.
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

  // Mount-only scroll listener: rAF-throttled so multiple scroll events coalesce into one repaint.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let rafId = 0
    const onScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        drawRef.current()
      })
    }
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      scroller.removeEventListener("scroll", onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  function resolveHeatmapCell(event: MouseEvent<HTMLCanvasElement>): HeatmapCell | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const yPixel = event.clientY - rect.top
    if (yPixel < HEADER_HEIGHT) return null
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    const rowIndex = Math.floor((yPixel - HEADER_HEIGHT + scrollTop) / ROW_HEIGHT)
    const row = heatmapRows[rowIndex]
    if (!row) return null
    if (x < LABEL_WIDTH + REPEAT_WIDTH) {
      return { row, block: "Concept", value: getBestHeatmapScore(row) } satisfies HeatmapCell
    }
    const blockIndex = Math.floor((x - LABEL_WIDTH - REPEAT_WIDTH) / COLUMN_WIDTH)
    const block = HEATMAP_BLOCKS[blockIndex]
    if (!block) return null
    return { row, block, value: getChartMetricValue(row, block, "-log10") } satisfies HeatmapCell
  }

  const clusteringBounded =
    heatmapOrderMode === "clustered" && heatmapRows.length > HEATMAP_MAX_CLUSTER_ROWS

  return (
    <Stack spacing={3}>
      <Grid container spacing={2} sx={{ p: 1 }}>
        {sharedControls}
        <Grid size={{ xs: 12, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-heatmap-order-label">Row Order</InputLabel>
            <Select
              labelId="duckdb-heatmap-order-label"
              value={heatmapOrderMode}
              label="Row Order"
              onChange={(event) => setHeatmapOrderMode(event.target.value as HeatmapOrderMode)}
            >
              <MenuItem value="repeatEvidence">Repeat evidence</MenuItem>
              <MenuItem value="strongest">Strongest overall</MenuItem>
              <MenuItem value="selectedBlock">Selected block</MenuItem>
              <MenuItem value="clustered">Clustered rows</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-heatmap-scale-label">Color Scale</InputLabel>
            <Select
              labelId="duckdb-heatmap-scale-label"
              value={heatmapScaleMode}
              label="Color Scale"
              onChange={(event) => setHeatmapScaleMode(event.target.value as HeatmapScaleMode)}
            >
              <MenuItem value="perColumn">Per column</MenuItem>
              <MenuItem value="global">Global</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <FormControl fullWidth size={"small"} disabled={heatmapOrderMode !== "selectedBlock"}>
            <InputLabel id="duckdb-heatmap-block-label">Order Block</InputLabel>
            <Select
              labelId="duckdb-heatmap-block-label"
              value={heatmapOrderBlock}
              label="Order Block"
              onChange={(event) => setHeatmapOrderBlock(event.target.value as ChartBlockKey)}
            >
              {COLUMNS.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-repeat-threshold-label">Repeat Threshold</InputLabel>
            <Select
              labelId="duckdb-repeat-threshold-label"
              value={String(repeatThreshold)}
              label="Repeat Threshold"
              onChange={(event) => setRepeatThreshold(Number(event.target.value))}
            >
              <MenuItem value="3">-log10(p) {">="} 3</MenuItem>
              <MenuItem value="5">-log10(p) {">="} 5</MenuItem>
              <MenuItem value="8">-log10(p) {">="} 8</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            size={"small"}
            label="Heatmap search"
            value={heatmapSearchText}
            onChange={(event) => setHeatmapSearchText(event.target.value)}
            placeholder="Filter heatmap by concept/code/id"
          />
        </Grid>
      </Grid>

      <Stack spacing={1.5}>
        {chartLoading && <Alert severity="info">Loading chart concepts from DuckDB...</Alert>}
        {clusteringBounded && (
          <Alert severity="info">
            Clustered the top {HEATMAP_MAX_CLUSTER_ROWS} concepts by evidence; the remaining{" "}
            {heatmapRows.length - HEATMAP_MAX_CLUSTER_ROWS} are appended by strength.
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary">
          Cell texture shows -log10(p) evidence by analysis block - the denser the pattern, the
          stronger the evidence. Repeat counts show how many blocks pass the selected threshold.
          Click a cell to jump that concept back into the table.
        </Typography>
        <PatternLegend />
        {heatmapSearchText.trim() ? (
          <Typography variant="body2" color="text.secondary">
            Showing {heatmapRows.length} of {rows.length} heatmap rows matching "{heatmapSearchText}
            ".
          </Typography>
        ) : null}
        <Paper sx={{ p: 1.5 }}>
          <Box
            ref={scrollRef}
            sx={{
              overflow: "auto",
              maxHeight: VIEWPORT_MAX,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            {/* Spacer drives the scrollbar; the canvas inside stays pinned and draws the window. */}
            <div style={{ position: "relative", width: CANVAS_WIDTH, height: contentHeight }}>
              <div
                style={{ position: "sticky", top: 0, height: viewportHeight, width: CANVAS_WIDTH }}
              >
                <canvas
                  ref={canvasRef}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    display: "block",
                    cursor: "pointer",
                  }}
                  onMouseMove={(event) => setHoveredCell(resolveHeatmapCell(event))}
                  onMouseLeave={() => setHoveredCell(null)}
                  onClick={(event) => {
                    const cell = resolveHeatmapCell(event)
                    if (cell) {
                      onSelectConcept(cell.row.rowKey)
                    }
                  }}
                />
              </div>
            </div>
          </Box>
        </Paper>
        {hoveredCell ? (
          <Alert severity="info">
            <strong>{hoveredCell.row.conceptName ?? hoveredCell.row.conceptId}</strong>
            {` | ${hoveredCell.block} | `}
            {hoveredCell.block === "Concept"
              ? `best cross-analysis -log10(p) ${hoveredCell.value == null ? "N/A" : formatNumber(hoveredCell.value, 2)} | repeat evidence ${getRepeatEvidenceCount(hoveredCell.row, repeatThreshold)}`
              : `-log10(p) ${hoveredCell.value == null ? "N/A" : formatNumber(hoveredCell.value, 2)} | repeat evidence ${getRepeatEvidenceCount(hoveredCell.row, repeatThreshold)}`}
          </Alert>
        ) : (
          <Alert severity="info">Hover a heatmap cell to inspect the concept and score.</Alert>
        )}
      </Stack>
    </Stack>
  )
}
