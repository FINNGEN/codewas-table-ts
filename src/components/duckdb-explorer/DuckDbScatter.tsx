import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Typography,
  useTheme,
} from "@mui/material"
import {
  ChartsClipPath,
  ChartsTooltipContainer,
  rainbowSurgePalette,
  ScatterChart,
  useDrawingArea,
  useItemTooltip,
  useXScale,
  useYScale,
  type ScatterMarkerProps,
  type ScatterItemIdentifier,
} from "@mui/x-charts"
import { dataHues } from "../../theme"
import { COLUMNS } from "../../utils/constants"
import {
  CHART_BLOCK_FIELD_PREFIX,
  OVERVIEW_DIVERGING_NEGATIVE,
  OVERVIEW_DIVERGING_POSITIVE,
  SCATTER_POINT_CAP,
} from "./constants"
import {
  getChartMetricValue,
  getEvidenceDirection,
  type EvidenceDirection,
} from "./utils/heatmapUtils"
import { negLog10 } from "./utils/utils"
import type { ChartBlockKey, ChartMetricKey, ConceptSummaryRow } from "./types"
import { ChartAboutDialog } from "./ChartAboutDialog"

type ScatterPoint = {
  id: string
  label: string
  x: number | null
  y: number | null
  xDirection: EvidenceDirection
  yDirection: EvidenceDirection
}

const DIRECTION_COLORS: Record<EvidenceDirection, string> = {
  positive: OVERVIEW_DIVERGING_POSITIVE,
  negative: OVERVIEW_DIVERGING_NEGATIVE,
  unsigned: dataHues.pvalue,
}

type DirectionGroup =
  | "bothPositive"
  | "bothNegative"
  | "xPositiveYNegative"
  | "xNegativeYPositive"
  | "hasUnsigned"

const DIRECTION_GROUPS: Array<{
  key: DirectionGroup
  label: string
  xDirection: EvidenceDirection
  yDirection: EvidenceDirection
}> = [
  {
    key: "bothPositive",
    label: "X positive / Y positive",
    xDirection: "positive",
    yDirection: "positive",
  },
  {
    key: "bothNegative",
    label: "X negative / Y negative",
    xDirection: "negative",
    yDirection: "negative",
  },
  {
    key: "xPositiveYNegative",
    label: "X positive / Y negative",
    xDirection: "positive",
    yDirection: "negative",
  },
  {
    key: "xNegativeYPositive",
    label: "X negative / Y positive",
    xDirection: "negative",
    yDirection: "positive",
  },
  {
    key: "hasUnsigned",
    label: "Unsigned/neutral on either axis",
    xDirection: "unsigned",
    yDirection: "unsigned",
  },
]

function directionGroup(point: Pick<ScatterPoint, "xDirection" | "yDirection">): DirectionGroup {
  if (point.xDirection === "unsigned" || point.yDirection === "unsigned") return "hasUnsigned"
  if (point.xDirection === "positive" && point.yDirection === "positive") return "bothPositive"
  if (point.xDirection === "negative" && point.yDirection === "negative") return "bothNegative"
  return point.xDirection === "positive" ? "xPositiveYNegative" : "xNegativeYPositive"
}

function ScatterInfoModal() {
  return (
    <ChartAboutDialog title="Scatter plot">
      <Typography variant="subtitle2" color="text.primary">Controls</Typography>
      <Typography variant="body2">
        <b>Plot scope</b> chooses the concept population, and <b>Plot type</b> switches between
        Scatter and Heatmap. <b>X axis</b> and <b>Y axis</b> choose the analyses. <b>Metric</b>
        applies the same measure to both axes: -log10(p), raw effect size, or standardized effect.
        <b>Regression line</b> toggles a straight-line fit to the displayed points.
      </Typography>
      <Typography variant="body2">
        For example, choose <b>Binary</b> on X, <b>Count</b> on Y, and <b>Standardized effect</b>
        to find concepts elevated in both analyses (upper right) or showing opposite directions.
        Choose <b>-log10(p)</b> instead to find concepts with strong evidence in both analyses;
        the split dot still shows effect direction even though position does not.
      </Typography>
      <Typography variant="subtitle2" color="text.primary">Reading the plot</Typography>
      <Typography variant="body2">
        Each dot is a concept result with values for both axes; results missing either value are
        omitted. The <b>left half</b> of a dot gives the X-axis effect direction and the <b>right
        half</b> gives the Y-axis direction. Red is positive, blue is negative, and purple means
        unsigned or neutral. Direction uses the standardized effect when available and otherwise
        uses the ordinary effect relative to its null value (1 for Binary/Count ratios, 0 for the
        other signed analyses). Categorical results are unsigned. Hover to inspect a dot and click
        it to open the detailed concept view.
      </Typography>
      <Typography variant="body2">
        Turn on <b>Rectangle select</b>, then drag across the plotting area. The selected dots are
        outlined and can be opened together in the flat table. Selection applies only to dots
        currently drawn in the scatter plot, including the 3,000-point display limit. Changing an
        axis, metric, or plot population clears the selection.
      </Typography>
      <Typography variant="body2">
        The direction combinations in the legend are also filters. Click one combination to isolate
        it, or click several to show their union. This is useful for finding concepts whose X and Y
        effects disagree. With no combination selected, all directions are shown. The regression
        line and rectangle selection use only the currently visible dots.
      </Typography>
      <Typography variant="body2">
        The regression slope (beta) and R-squared describe the displayed points; they do not
        establish causation. If more than 3,000 points qualify, a warning indicates that the plot
        is limited to 3,000.
      </Typography>
    </ChartAboutDialog>
  )
}

export function DuckDbScatter({
  rows,
  chartLoading,
  onSelectConcept,
  onOpenConceptSet,
  sharedControls,
}: {
  rows: ConceptSummaryRow[]
  chartLoading: boolean
  onSelectConcept: (rowKey: string) => void
  onOpenConceptSet: (selection: { label: string; rowKeys: string[] }) => void
  sharedControls: ReactNode
}) {
  const [xBlock, setXBlock] = useState<ChartBlockKey>("Binary")
  const [yBlock, setYBlock] = useState<ChartBlockKey>("Count")
  const [metric, setMetric] = useState<ChartMetricKey>("-log10")
  const metricLabel =
    metric === "-log10" ? "-log10(p)" : metric === "effectSize" ? "effect size" : "standardized effect"

  const [showRegression, setShowRegression] = useState(true)
  const [selectionEnabled, setSelectionEnabled] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [activeDirectionGroups, setActiveDirectionGroups] = useState<DirectionGroup[]>([])
  const toggleRegression = () => setShowRegression((prev) => !prev)

  const allScatterPoints = useMemo<ScatterPoint[]>(
    () =>
      rows
        .map((row) => ({
          id: row.rowKey,
          label: row.conceptName ?? String(row.conceptId),
          x: getChartMetricValue(row, xBlock, metric),
          y: getChartMetricValue(row, yBlock, metric),
          xDirection: getEvidenceDirection(row, xBlock),
          yDirection: getEvidenceDirection(row, yBlock),
        }))
        .filter((row) => row.x != null && row.y != null),
    [metric, rows, xBlock, yBlock],
  )
  const directionGroupCounts = useMemo(() => {
    const counts = Object.fromEntries(DIRECTION_GROUPS.map(({ key }) => [key, 0])) as Record<
      DirectionGroup,
      number
    >
    for (const point of allScatterPoints) counts[directionGroup(point)] += 1
    return counts
  }, [allScatterPoints])
  const directionFilteredPoints = useMemo(() => {
    if (activeDirectionGroups.length === 0) return allScatterPoints
    const active = new Set(activeDirectionGroups)
    return allScatterPoints.filter((point) => active.has(directionGroup(point)))
  }, [activeDirectionGroups, allScatterPoints])
  const dataset = useMemo(
    () => directionFilteredPoints.slice(0, SCATTER_POINT_CAP),
    [directionFilteredPoints],
  )
  const selectedRowKeySet = useMemo(() => new Set(selectedRowKeys), [selectedRowKeys])

  useEffect(() => {
    setSelectedRowKeys([])
  }, [metric, xBlock, yBlock])

  useEffect(() => {
    // Table view deliberately clears chart rows to avoid background DuckDB/chart work. Preserve the
    // current selection across that temporary empty state, then discard only keys that are truly no
    // longer in the reloaded plot population.
    if (rows.length === 0) return
    const available = new Set(rows.map((row) => row.rowKey))
    setSelectedRowKeys((current) => current.filter((rowKey) => available.has(rowKey)))
  }, [rows])

  useEffect(() => {
    if (rows.length === 0) return
    const visible = new Set(dataset.map((point) => point.id))
    setSelectedRowKeys((current) => current.filter((rowKey) => visible.has(rowKey)))
  }, [dataset, rows.length])

  const regression = useMemo(
    () => linearRegression(dataset as { x: number; y: number }[]),
    [dataset],
  )
  const rowsByKey = useMemo(() => {
    const map = new Map<string, ConceptSummaryRow>()
    for (const row of rows) map.set(row.rowKey, row)
    return map
  }, [rows])

  // The tooltip slot replaces MUI's default popper entirely, so it needs the concept row that is
  // not carried in the lean chart dataset. Memoize a component that closes over the current lookup +
  // selected blocks; its identity only changes when those change (remounting the tooltip is cheap).
  const ConceptTooltip = useMemo(() => {
    return function ConceptTooltip() {
      const tooltip = useItemTooltip<"scatter">()
      if (!tooltip) return null
      const point = dataset[tooltip.identifier.dataIndex]
      const row = point ? rowsByKey.get(point.id) : undefined
      if (!row) return null
      return (
        <ChartsTooltipContainer trigger="item">
          <ConceptTooltipContent row={row} xBlock={xBlock} yBlock={yBlock} metric={metric} />
        </ChartsTooltipContainer>
      )
    }
  }, [dataset, rowsByKey, xBlock, yBlock, metric])

  const DirectionMarker = useMemo(() => {
    return function DirectionMarker(props: ScatterMarkerProps) {
      const point = dataset[props.dataIndex]
      return (
        <SplitDirectionMarker
          {...props}
          xDirection={point?.xDirection ?? "unsigned"}
          yDirection={point?.yDirection ?? "unsigned"}
          selected={point ? selectedRowKeySet.has(point.id) : false}
        />
      )
    }
  }, [dataset, selectedRowKeySet])

  return (
    <Stack spacing={3}>
      <Grid container spacing={2} sx={{ p: 1, pt: 2 }}>
        <Grid size={12}>
          <Grid container spacing={2}>
            {sharedControls}
            <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "flex-end" }}>
              <ScatterInfoModal />
            </Grid>
          </Grid>
        </Grid>
        <Grid size={12}>
          <Grid container spacing={2} sx={{ alignItems: "center" }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-chart-x-label">X Axis</InputLabel>
            <Select
              labelId="duckdb-chart-x-label"
              value={xBlock}
              label="X Axis"
              onChange={(event) => setXBlock(event.target.value as ChartBlockKey)}
            >
              {COLUMNS.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-chart-y-label">Y Axis</InputLabel>
            <Select
              labelId="duckdb-chart-y-label"
              value={yBlock}
              label="Y Axis"
              onChange={(event) => setYBlock(event.target.value as ChartBlockKey)}
            >
              {COLUMNS.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size={"small"}>
            <InputLabel id="duckdb-chart-metric-label">Metric</InputLabel>
            <Select
              labelId="duckdb-chart-metric-label"
              value={metric}
              label="Metric"
              onChange={(event) => setMetric(event.target.value as ChartMetricKey)}
            >
              <MenuItem value="-log10">-log10(p)</MenuItem>
              <MenuItem value="effectSize">Effect size</MenuItem>
              <MenuItem value="standardizedEffect">Standardized effect</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <FormControl size="small" fullWidth>
          <FormControlLabel
            control={<Switch checked={showRegression} size="small" onChange={toggleRegression} />}
            label={
              Number.isFinite(regression.m)
                ? `Regression line (β = ${regression.m.toFixed(3)}, R^2 = ${regression.r2.toFixed(2)})`
                : "Regression line"
            }
          />
        </FormControl>
        </Grid>
          </Grid>
        </Grid>
      </Grid>

      {chartLoading && <Alert severity="info">Loading chart concepts from DuckDB...</Alert>}
      {directionFilteredPoints.length > SCATTER_POINT_CAP && (
        <Alert severity="warning">
          Showing top {SCATTER_POINT_CAP} of {directionFilteredPoints.length} plottable concepts in
          the selected direction groups. Apply filters to reduce the dataset.
        </Alert>
      )}
      {dataset.length === 0 ? (
        <Alert severity="info">No rows have both selected metrics available.</Alert>
      ) : (
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", lg: "row" },
            alignItems: "stretch",
            gap: 1.5,
            width: "100%",
          }}
        >
        <Paper sx={{ flex: 1, minWidth: 0, height: 500, p: 1 }}>
          <ScatterChart
            dataset={dataset}
            series={[
              {
                id: "has-value",
                datasetKeys: { id: "id", x: "x", y: "y" },
                label: "Concept",
                markerSize: 4,
              },
            ]}
            xAxis={[
              {
                label: `${COLUMNS.find((column) => column.key === xBlock)?.label ?? xBlock} ${metricLabel}`,
              },
            ]}
            yAxis={[
              {
                label: `${COLUMNS.find((column) => column.key === yBlock)?.label ?? yBlock} ${metricLabel}`,
              },
            ]}
            height={460}
            hideLegend
            hitAreaRadius="item"
            slots={{ tooltip: ConceptTooltip, marker: DirectionMarker }}
            onItemClick={(_: unknown, d: ScatterItemIdentifier) => {
              if (selectionEnabled) return
              const point = dataset[d.dataIndex]
              if (point) onSelectConcept(point.id)
            }}
          >
            {showRegression && (
              <RegressionLine seriesId="has-value" fit={regression} colorIndex={2} />
            )}
            {!selectionEnabled && <HoveredPointHighlight dataset={dataset} />}
            <RectangleSelectionOverlay
              active={selectionEnabled}
              dataset={dataset}
              onSelectionChange={setSelectedRowKeys}
            />
          </ScatterChart>
        </Paper>
        <ScatterDirectionLegend
          activeDirectionGroups={activeDirectionGroups}
          directionGroupCounts={directionGroupCounts}
          onToggleDirectionGroup={(group) => {
            setActiveDirectionGroups((current) =>
              current.includes(group)
                ? current.filter((candidate) => candidate !== group)
                : [...current, group],
            )
            setSelectedRowKeys([])
          }}
          onShowAllDirections={() => {
            setActiveDirectionGroups([])
            setSelectedRowKeys([])
          }}
          selectionEnabled={selectionEnabled}
          selectedCount={selectedRowKeys.length}
          onToggleSelection={() => {
            setSelectionEnabled((current) => !current)
            setSelectedRowKeys([])
          }}
          onClear={() => setSelectedRowKeys([])}
          onOpen={() =>
            onOpenConceptSet({
              label: `Scatter: ${blockLabel(xBlock)} vs ${blockLabel(yBlock)}`,
              rowKeys: selectedRowKeys,
            })
          }
        />
        </Box>
      )}
    </Stack>
  )
}

function SplitDirectionMarker({
  x,
  y,
  size,
  isHighlighted,
  isFaded,
  onClick,
  xDirection,
  yDirection,
  selected,
}: ScatterMarkerProps & {
  xDirection: EvidenceDirection
  yDirection: EvidenceDirection
  selected: boolean
}) {
  const theme = useTheme()
  const radius = (isHighlighted ? 1.2 : 1) * size
  return (
    <g
      transform={`translate(${x}, ${y})`}
      opacity={isFaded ? 0.3 : 1}
      cursor={onClick ? "pointer" : "default"}
      onClick={onClick}
    >
      <path
        d={`M 0 ${-radius} A ${radius} ${radius} 0 0 0 0 ${radius} Z`}
        fill={DIRECTION_COLORS[xDirection]}
      />
      <path
        d={`M 0 ${-radius} A ${radius} ${radius} 0 0 1 0 ${radius} Z`}
        fill={DIRECTION_COLORS[yDirection]}
      />
      <circle
        cx={0}
        cy={0}
        r={selected ? radius + 2 : radius}
        fill="none"
        stroke={selected ? theme.palette.text.primary : theme.palette.divider}
        strokeWidth={selected ? 2 : 0.75}
        pointerEvents="none"
      />
    </g>
  )
}

function RectangleSelectionOverlay({
  active,
  dataset,
  onSelectionChange,
}: {
  active: boolean
  dataset: ScatterPoint[]
  onSelectionChange: (rowKeys: string[]) => void
}) {
  const theme = useTheme()
  const drawingArea = useDrawingArea()
  const xScale = useXScale()
  const yScale = useYScale()
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)

  const pointerPosition = (event: ReactPointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return null
    const matrix = svg.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return {
      x: Math.max(drawingArea.left, Math.min(drawingArea.left + drawingArea.width, point.x)),
      y: Math.max(drawingArea.top, Math.min(drawingArea.top + drawingArea.height, point.y)),
    }
  }

  const finishSelection = (end: { x: number; y: number } | null) => {
    if (!start || !end) {
      setStart(null)
      setCurrent(null)
      return
    }
    const left = Math.min(start.x, end.x)
    const right = Math.max(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const bottom = Math.max(start.y, end.y)
    if (right - left < 3 || bottom - top < 3) {
      onSelectionChange([])
    } else {
      onSelectionChange(
        dataset
          .filter((point) => {
            if (point.x == null || point.y == null) return false
            const px = xScale(point.x)
            const py = yScale(point.y)
            return px != null && py != null && px >= left && px <= right && py >= top && py <= bottom
          })
          .map((point) => point.id),
      )
    }
    setStart(null)
    setCurrent(null)
  }

  const selectionRect =
    start && current
      ? {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null

  return (
    <g>
      <rect
        x={drawingArea.left}
        y={drawingArea.top}
        width={drawingArea.width}
        height={drawingArea.height}
        fill="transparent"
        pointerEvents={active ? "all" : "none"}
        cursor={active ? "crosshair" : "default"}
        onPointerDown={(event) => {
          if (!active || event.button !== 0) return
          const point = pointerPosition(event)
          if (!point) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setStart(point)
          setCurrent(point)
        }}
        onPointerMove={(event) => {
          if (!start) return
          const point = pointerPosition(event)
          if (point) setCurrent(point)
        }}
        onPointerUp={(event) => {
          if (!start) return
          finishSelection(pointerPosition(event))
        }}
        onPointerCancel={() => {
          setStart(null)
          setCurrent(null)
        }}
      />
      {selectionRect && (
        <rect
          {...selectionRect}
          fill={theme.palette.primary.main}
          fillOpacity={0.12}
          stroke={theme.palette.primary.main}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      )}
    </g>
  )
}

function LegendDot({
  xDirection,
  yDirection,
  size = 18,
}: {
  xDirection: EvidenceDirection
  yDirection: EvidenceDirection
  size?: number
}) {
  return (
    <Box component="svg" viewBox="-6 -6 12 12" sx={{ width: size, height: size, flex: "0 0 auto" }}>
      <path d="M 0 -5 A 5 5 0 0 0 0 5 Z" fill={DIRECTION_COLORS[xDirection]} />
      <path d="M 0 -5 A 5 5 0 0 1 0 5 Z" fill={DIRECTION_COLORS[yDirection]} />
      <circle cx="0" cy="0" r="5" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </Box>
  )
}

function AllDirectionsIcon() {
  return (
    <Box
      sx={{ width: 18, height: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}
    >
      <LegendDot xDirection="positive" yDirection="positive" size={8} />
      <LegendDot xDirection="negative" yDirection="negative" size={8} />
      <LegendDot xDirection="positive" yDirection="negative" size={8} />
      <LegendDot xDirection="negative" yDirection="positive" size={8} />
    </Box>
  )
}

function ScatterDirectionLegend({
  activeDirectionGroups,
  directionGroupCounts,
  onToggleDirectionGroup,
  onShowAllDirections,
  selectionEnabled,
  selectedCount,
  onToggleSelection,
  onClear,
  onOpen,
}: {
  activeDirectionGroups: DirectionGroup[]
  directionGroupCounts: Record<DirectionGroup, number>
  onToggleDirectionGroup: (group: DirectionGroup) => void
  onShowAllDirections: () => void
  selectionEnabled: boolean
  selectedCount: number
  onToggleSelection: () => void
  onClear: () => void
  onOpen: () => void
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        width: { xs: "100%", lg: 230 },
        flex: { lg: "0 0 230px" },
        p: 1.5,
      }}
    >
      <Typography variant="subtitle2">Effect direction</Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        <Button
          size="small"
          color="inherit"
          variant={activeDirectionGroups.length === 0 ? "outlined" : "text"}
          aria-pressed={activeDirectionGroups.length === 0}
          onClick={onShowAllDirections}
          startIcon={<AllDirectionsIcon />}
          sx={{
            justifyContent: "flex-start",
            px: 0.75,
            minHeight: 28,
            bgcolor: activeDirectionGroups.length === 0 ? "action.selected" : "transparent",
            textTransform: "none",
            fontSize: "0.72rem",
            lineHeight: 1.2,
            "& .MuiButton-startIcon": { mr: 0.75 },
          }}
        >
          <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
            All direction combinations
          </Box>
          <Box component="span" sx={{ ml: 0.75, color: "text.secondary" }}>
            {Object.values(directionGroupCounts)
              .reduce((sum, count) => sum + count, 0)
              .toLocaleString()}
          </Box>
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.75, py: 0.25 }}>
          Dot halves: left = X axis; right = Y axis. Click combinations to filter.
        </Typography>
        {DIRECTION_GROUPS.map((group) => {
          const active = activeDirectionGroups.includes(group.key)
          return (
            <Button
              key={group.key}
              size="small"
              color="inherit"
              variant={active ? "outlined" : "text"}
              aria-pressed={active}
              onClick={() => onToggleDirectionGroup(group.key)}
              startIcon={
                <LegendDot
                  xDirection={group.xDirection}
                  yDirection={group.yDirection}
                />
              }
              sx={{
                justifyContent: "flex-start",
                px: 0.75,
                minHeight: 28,
                bgcolor: active ? "action.selected" : "transparent",
                textTransform: "none",
                fontSize: "0.72rem",
                lineHeight: 1.2,
                "& .MuiButton-startIcon": { mr: 0.75 },
              }}
            >
              <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
                {group.label}
              </Box>
              <Box component="span" sx={{ ml: 0.75, color: "text.secondary" }}>
                {directionGroupCounts[group.key].toLocaleString()}
              </Box>
            </Button>
          )
        })}
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2">Select concepts</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Turn on selection, then drag a rectangle over the plot.
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Button
          size="small"
          variant={selectionEnabled ? "contained" : "outlined"}
          onClick={onToggleSelection}
        >
          {selectionEnabled ? "Selecting: drag on plot" : "Rectangle select"}
        </Button>
        <Button size="small" variant="outlined" disabled={selectedCount === 0} onClick={onOpen}>
          Open {selectedCount || "selected"} in table
        </Button>
        {selectedCount > 0 && (
          <Button size="small" color="inherit" onClick={onClear}>
            Clear selection
          </Button>
        )}
      </Stack>
    </Paper>
  )
}

function RegressionLine({
  seriesId,
  fit,
  colorIndex,
}: {
  seriesId: string
  fit: { m: number; b: number }
  colorIndex: number
}) {
  const theme = useTheme()
  const palette = rainbowSurgePalette(theme.palette.mode)
  const stroke = palette[colorIndex]
  const xScale = useXScale()
  const yScale = useYScale()
  const clipPathId = `linear-regression-clip-${seriesId}-${useId()}`

  const { m, b } = fit

  const xDomain = xScale.domain() as [number, number]
  const x1 = xScale(xDomain[0])
  const x2 = xScale(xDomain[1])
  const y1 = yScale(m * xDomain[0] + b)
  const y2 = yScale(m * xDomain[1] + b)

  return (
    <Fragment>
      <ChartsClipPath id={clipPathId} />
      <g clipPath={`url(#${clipPathId})`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={1} strokeOpacity={0.5} />
      </g>
    </Fragment>
  )
}

// Draws a ring around the point currently under the hit area. Reads the same tooltip item state the
// custom tooltip uses, so the highlight and tooltip appear/disappear together (both go null once the
// pointer leaves a dot's hit area, thanks to hitAreaRadius="item").
function HoveredPointHighlight({ dataset }: { dataset: ScatterPoint[] }) {
  const theme = useTheme()
  const tooltip = useItemTooltip<"scatter">()
  const xScale = useXScale()
  const yScale = useYScale()
  if (!tooltip) return null
  const point = dataset[tooltip.identifier.dataIndex]
  if (!point || point.x == null || point.y == null) return null
  const cx = xScale(point.x)
  const cy = yScale(point.y)
  if (cx == null || cy == null) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={7}
      fill="none"
      stroke={theme.palette.primary.main}
      strokeWidth={2}
      pointerEvents="none"
    />
  )
}

const CATEGORICAL_BLOCKS: ChartBlockKey[] = ["Binary", "Categorical"]

function blockLabel(block: ChartBlockKey) {
  return COLUMNS.find((column) => column.key === block)?.label ?? block
}

function directionLabel(direction: EvidenceDirection) {
  return direction === "positive"
    ? "positive"
    : direction === "negative"
      ? "negative"
      : "unsigned/neutral"
}

function readNumber(row: ConceptSummaryRow, field: string): number | null {
  const value = row[field as keyof ConceptSummaryRow]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readString(row: ConceptSummaryRow, field: string): string | null {
  const value = row[field as keyof ConceptSummaryRow]
  return typeof value === "string" && value.length > 0 ? value : null
}

function formatNumber(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-"
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return value.toExponential(1)
  return value.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatPValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-"
  if (value === 0) return "0"
  if (value < 1e-3) return value.toExponential(1)
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function meanSd(mean: number | null, sd: number | null): string {
  if (mean == null) return "-"
  return sd == null ? formatNumber(mean) : `${formatNumber(mean)} +/- ${formatNumber(sd)}`
}

type StatLine = { label: string; caseText: string; controlText: string }

type BlockDetail = {
  testName: string | null
  pValue: number | null
  logp: number | null
  effectSize: number | null
  smd: number | null
  unit: string | null
  lines: StatLine[]
}

function getBlockDetail(row: ConceptSummaryRow, block: ChartBlockKey): BlockDetail {
  const prefix = CHART_BLOCK_FIELD_PREFIX[block]
  const pValue = readNumber(row, `${prefix}PValue`)
  const detail: BlockDetail = {
    testName: readString(row, `${prefix}TestName`),
    pValue,
    logp: negLog10(pValue),
    effectSize: readNumber(row, `${prefix}EffectSize`),
    smd: readNumber(row, `${prefix}Smd`),
    unit: block === "Continuous" ? readString(row, "continuousUnit") : null,
    lines: [],
  }

  if (CATEGORICAL_BLOCKS.includes(block)) {
    const caseYes = readNumber(row, `${prefix}CaseYes`)
    const controlYes = readNumber(row, `${prefix}ControlYes`)
    const totalCases = readNumber(row, "binaryTotalCases")
    const totalControls = readNumber(row, "binaryTotalControls")
    detail.lines.push({
      label: "Present",
      caseText:
        totalCases != null
          ? `${formatNumber(caseYes, 0)} / ${formatNumber(totalCases, 0)}`
          : formatNumber(caseYes, 0),
      controlText:
        totalControls != null
          ? `${formatNumber(controlYes, 0)} / ${formatNumber(totalControls, 0)}`
          : formatNumber(controlYes, 0),
    })
  } else {
    detail.lines.push(
      {
        label: "n",
        caseText: formatNumber(readNumber(row, `${prefix}CaseCount`), 0),
        controlText: formatNumber(readNumber(row, `${prefix}ControlCount`), 0),
      },
      {
        label: "Mean +/- SD",
        caseText: meanSd(readNumber(row, `${prefix}CaseMean`), readNumber(row, `${prefix}CaseSd`)),
        controlText: meanSd(
          readNumber(row, `${prefix}ControlMean`),
          readNumber(row, `${prefix}ControlSd`),
        ),
      },
      {
        label: "Median",
        caseText: formatNumber(readNumber(row, `${prefix}MedianCase`)),
        controlText: formatNumber(readNumber(row, `${prefix}MedianControl`)),
      },
    )
  }

  return detail
}

function ConceptTooltipContent({
  row,
  xBlock,
  yBlock,
  metric,
}: {
  row: ConceptSummaryRow
  xBlock: ChartBlockKey
  yBlock: ChartBlockKey
  metric: ChartMetricKey
}) {
  const theme = useTheme()
  const blocks = xBlock === yBlock ? [xBlock] : [xBlock, yBlock]

  const axisTag = (block: ChartBlockKey) => {
    if (block === xBlock && block === yBlock) return "X · Y"
    return block === xBlock ? "X" : "Y"
  }

  return (
    <Box
      sx={{
        p: 1.5,
        maxWidth: 340,
        boxShadow: theme.shadows[3],
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
        {row.conceptName ?? `Concept ${row.conceptId}`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {[row.conceptCode, row.domainId, `#${row.conceptId}`].filter(Boolean).join(" · ")}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.75 }}>
        <LegendDot
          xDirection={getEvidenceDirection(row, xBlock)}
          yDirection={getEvidenceDirection(row, yBlock)}
        />
        <Typography variant="caption">
          X: {directionLabel(getEvidenceDirection(row, xBlock))}; Y:{" "}
          {directionLabel(getEvidenceDirection(row, yBlock))}
        </Typography>
      </Stack>

      {blocks.map((block) => {
        const detail = getBlockDetail(row, block)
        return (
          <Fragment key={block}>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {blockLabel(block)}
                {detail.unit ? ` (${detail.unit})` : ""}
              </Typography>
              <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>
                {axisTag(block)}
              </Typography>
            </Box>
            {detail.testName && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {detail.testName}
              </Typography>
            )}
            <Box
              sx={{
                mt: 0.5,
                display: "grid",
                gridTemplateColumns: "auto 1fr 1fr",
                columnGap: 1.5,
                rowGap: 0.25,
                fontSize: theme.typography.caption.fontSize,
              }}
            >
              {/* <Box />
              <Box sx={{ fontWeight: 600 }}>Case</Box>
              <Box sx={{ fontWeight: 600 }}>Control</Box>
              {detail.lines.map((line) => (
                <Fragment key={line.label}>
                  <Box sx={{ color: "text.secondary" }}>{line.label}</Box>
                  <Box>{line.caseText}</Box>
                  <Box>{line.controlText}</Box>
                </Fragment>
              ))} */}
            </Box>
            <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 1.5 }}>
              <MetricChip
                label="p"
                value={formatPValue(detail.pValue)}
                highlight={metric === "-log10"}
              />
              <MetricChip
                label="-log10(p)"
                value={formatNumber(detail.logp)}
                highlight={metric === "-log10"}
              />
              <MetricChip
                label="Effect"
                value={formatNumber(detail.effectSize)}
                highlight={metric === "effectSize"}
              />
              <MetricChip
                label="Standardized effect"
                value={formatNumber(detail.smd)}
                highlight={metric === "standardizedEffect"}
              />
            </Box>
          </Fragment>
        )
      })}
    </Box>
  )
}

function MetricChip({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight: boolean
}) {
  return (
    <Typography variant="caption" sx={{ fontWeight: highlight ? 700 : 400 }}>
      <Box component="span" sx={{ color: "text.secondary" }}>
        {label}:{" "}
      </Box>
      {value}
    </Typography>
  )
}

function linearRegression(points: ReadonlyArray<{ x: number; y: number }>) {
  const n = points.length
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0

  for (let i = 0; i < n; i += 1) {
    const { x, y } = points[i]
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
    sumY2 += y * y
  }

  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const b = (sumY - m * sumX) / n

  // Pearson r, so the label can report goodness of fit alongside the slope
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  const r = den === 0 ? NaN : (n * sumXY - sumX * sumY) / den

  return { m, b, r, r2: r * r }
}
