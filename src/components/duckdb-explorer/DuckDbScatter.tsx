import { Fragment, useId, useMemo, useState, type ReactNode } from "react"
import {
  Alert,
  Box,
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
  useItemTooltip,
  useSeries,
  useXScale,
  useYScale,
  type ScatterItemIdentifier,
} from "@mui/x-charts"
import { COLUMNS } from "../../utils/constants"
import { CHART_BLOCK_FIELD_PREFIX, SCATTER_POINT_CAP } from "./constants"
import { getChartMetricValue } from "./utils/heatmapUtils"
import { negLog10 } from "./utils/utils"
import type { ChartBlockKey, ChartMetricKey, ConceptSummaryRow } from "./types"
import { useClipboard } from "./context/ClipboardContext"

type ScatterPoint = { id: string; label: string; x: number | null; y: number | null }

export function DuckDbScatter({
  rows,
  chartLoading,
  sharedControls,
}: {
  rows: ConceptSummaryRow[]
  chartLoading: boolean
  sharedControls: ReactNode
}) {
  const { copy } = useClipboard()
  const [xBlock, setXBlock] = useState<ChartBlockKey>("Binary")
  const [yBlock, setYBlock] = useState<ChartBlockKey>("Count")
  const [metric, setMetric] = useState<ChartMetricKey>("-log10")

  const [showRegression, setShowRegression] = useState(true)
  const toggleRegression = () => setShowRegression((prev) => !prev)

  const allScatterPoints = useMemo<ScatterPoint[]>(
    () =>
      rows
        .map((row) => ({
          id: row.rowKey,
          label: row.conceptName ?? String(row.conceptId),
          x: getChartMetricValue(row, xBlock, metric),
          y: getChartMetricValue(row, yBlock, metric),
        }))
        .filter((row) => row.x != null && row.y != null),
    [metric, rows, xBlock, yBlock],
  )
  const dataset = useMemo(() => allScatterPoints.slice(0, SCATTER_POINT_CAP), [allScatterPoints])

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

  return (
    <Stack spacing={3}>
      <Grid container spacing={2} sx={{ p: 1, pt: 2 }}>
        {sharedControls}
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
            </Select>
          </FormControl>
        </Grid>
        <FormControl size="small">
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

      {chartLoading && <Alert severity="info">Loading chart concepts from DuckDB...</Alert>}
      {allScatterPoints.length > SCATTER_POINT_CAP && (
        <Alert severity="warning">
          Showing top {SCATTER_POINT_CAP} of {allScatterPoints.length} plotable concepts. Apply
          filters to reduce the dataset.
        </Alert>
      )}
      {dataset.length === 0 ? (
        <Alert severity="info">No rows have both selected metrics available.</Alert>
      ) : (
        <Paper sx={{ width: "100%", height: 500, p: 1 }}>
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
                label: `${COLUMNS.find((column) => column.key === xBlock)?.label ?? xBlock} ${metric}`,
              },
            ]}
            yAxis={[
              {
                label: `${COLUMNS.find((column) => column.key === yBlock)?.label ?? yBlock} ${metric}`,
              },
            ]}
            height={460}
            hitAreaRadius="item"
            slots={{ tooltip: ConceptTooltip }}
            onItemClick={(_: any, d: ScatterItemIdentifier) => {
              copy(dataset[d.dataIndex].label, "Copied Concept Name")
            }}
          >
            {showRegression && (
              <RegressionLine seriesId="has-value" fit={regression} colorIndex={2} />
            )}
            <HoveredPointHighlight dataset={dataset} />
          </ScatterChart>
        </Paper>
      )}
    </Stack>
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
  const allSeries = useSeries()
  const series = allSeries.scatter!.series[seriesId]!
  const xScale = useXScale(series.xAxisId!)
  const yScale = useYScale(series.yAxisId!)
  const clipPathId = `linear-regression-clip-${useId()}`

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
              {/* <MetricChip label="SMD" value={formatNumber(detail.smd)} highlight={false} /> */}
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
