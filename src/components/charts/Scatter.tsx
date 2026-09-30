import {
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  useTheme,
  type SelectChangeEvent,
} from "@mui/material"
import type { Columns, ConceptRow } from "../../utils/types"
import {
  ChartsClipPath,
  rainbowSurgePalette,
  ScatterChart,
  useSeries,
  useXScale,
  useYScale,
} from "@mui/x-charts"
import { Fragment } from "react/jsx-runtime"
import { useId, useState } from "react"
import { COLUMNS } from "../../utils/constants"
import type { MRT_TableInstance } from "material-react-table"

type ScatterKey = "pValue" | "effectSize" | "standardizedMeanDifference" | "-log10"

type KeyOption = {
  label: string
  key: ScatterKey
}

const KEYS: KeyOption[] = [
  { label: "pValue", key: "-log10" },
  { label: "Effect Size", key: "effectSize" },
]

type ScatterDimensions = {
  x: Columns
  y: Columns
}

type Metric = "-log10" | "effectSize" | "standardizedMeanDifference"

const COLUMN_MAP: Record<Columns, Partial<Record<Metric, string>>> = {
  Binary: { "-log10": "-log10Binary", effectSize: "oddsRatioBinary" },
  Count: { "-log10": "-log10Count", effectSize: "effectSizeCount" },
  Age: { "-log10": "-log10Age", effectSize: "effectSizeAge" },
  Days: { "-log10": "-log10Days", effectSize: "effectSizeDays" },
  Continuous: { "-log10": "-log10Continuous", effectSize: "effectSizeContinuous" },
  Categorical: { "-log10": "-log10Category", effectSize: "effectSizeCategory" },
}

// resolve the actual MRT column id from domain + metric
const getColumnId = (domain: Columns, metric: Metric) => COLUMN_MAP[domain][metric]

export function Scatter({ data }: { data: MRT_TableInstance<ConceptRow> }) {
  const theme = useTheme()
  const palette = rainbowSurgePalette(theme.palette.mode)

  // Now a single key selector drives the metric, COLUMNS drive the axes
  const [scatterPlotDimensions, setScatterPlotDimensions] = useState<ScatterDimensions>({
    x: "Binary",
    y: "Count",
  })

  const [scatterPlotValue, setScatterPlotValue] = useState<Metric>("-log10")
  const [showRegression, setShowRegression] = useState(true)

  const rows = data.getSortedRowModel().rows
  console.log(rows.length)

  if (rows.length === 0) return <p>Ungroup to see the chart</p>

  const scatterDataset = rows.map((row) => {
    const xValue = row.getValue<number>(
      getColumnId(scatterPlotDimensions.x, scatterPlotValue) ?? "",
    )
    const yValue = row.getValue<number>(
      getColumnId(scatterPlotDimensions.y, scatterPlotValue) ?? "",
    )
    return {
      uniqID: row.id,
      id: row.getValue<number>("conceptId"),
      name: row.getValue<string>("conceptName"),
      x1: scatterPlotValue === "-log10" ? Math.pow(10, -xValue) : xValue,
      y1: scatterPlotValue === "-log10" ? Math.pow(10, -yValue) : yValue,
    }
  })

  const handleAxisChange = (axis: keyof ScatterDimensions) => (e: SelectChangeEvent<Columns>) => {
    setScatterPlotDimensions((prev) => ({ ...prev, [axis]: e.target.value as Columns }))
  }

  const handleKeyChange = (e: SelectChangeEvent<Metric>) => {
    setScatterPlotValue(e.target.value as Metric)
  }

  return (
    <Grid spacing={2} size={{ xs: 12, md: 6 }}>
      <Grid spacing={2} direction={"row"}>
        {/* X axis: picks a column */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>X Axis</InputLabel>
          <Select<Columns>
            value={scatterPlotDimensions.x}
            label="X Axis"
            onChange={handleAxisChange("x")}
          >
            {COLUMNS.map((col) => (
              <MenuItem key={col.key} value={col.key}>
                {col.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {/* Y axis: picks a column */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Y Axis</InputLabel>
          <Select<Columns>
            value={scatterPlotDimensions.y}
            label="Y Axis"
            onChange={handleAxisChange("y")}
          >
            {COLUMNS.map((col) => (
              <MenuItem key={col.key} value={col.key}>
                {col.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {/* Metric: picks a key (pValue, effectSize, etc.) */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Metric</InputLabel>
          <Select<Metric> value={scatterPlotValue} label="Metric" onChange={handleKeyChange}>
            {KEYS.map((k) => (
              <MenuItem key={k.key} value={k.key}>
                {k.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <FormControlLabel control={<Switch defaultChecked />} label="Regression line [VALUE]" />
        </FormControl>
      </Grid>
      <Paper sx={{ width: "100%", height: 400 }}>
        <ScatterChart
          hideLegend
          dataset={scatterDataset}
          series={[
            {
              id: "has-value",
              datasetKeys: { x: "x1", y: "y1", id: "uniqID" },
              markerSize: 3,
              label: "Concept",
              color: palette[2],
              valueFormatter: (v) => v && `${v.id} - x: ${v.x}, y: ${v.y}`,
            },
          ]}
          xAxis={[
            {
              height: 50,
              tickLabelPlacement: "middle",
              tickLabelStyle: { fontSize: 10, fontWeight: "bold" },
              label:
                COLUMNS.find((c) => c.key === scatterPlotDimensions.x)?.label ??
                scatterPlotDimensions.x, // column name as axis label
              labelStyle: { fontSize: 10, fontWeight: "bold" },
            },
          ]}
          yAxis={[
            {
              width: 75,
              tickLabelPlacement: "middle",
              tickLabelStyle: { fontSize: 10, fontWeight: "bold" },
              label:
                COLUMNS.find((c) => c.key === scatterPlotDimensions.y)?.label ??
                scatterPlotDimensions.y, // column name as axis label
              labelStyle: { fontSize: 10, fontWeight: "bold" },
            },
          ]}
          grid={{ vertical: true, horizontal: true }}
        >
          {showRegression && <RegressionLine seriesId="has-value" colorIndex={2} />}
        </ScatterChart>
      </Paper>
    </Grid>
  )
}

function RegressionLine({ seriesId, colorIndex }: { seriesId: string; colorIndex: number }) {
  const theme = useTheme()
  const palette = rainbowSurgePalette(theme.palette.mode)
  const stroke = palette[colorIndex]
  const allSeries = useSeries()
  const series = allSeries.scatter!.series[seriesId]!
  const xScale = useXScale(series.xAxisId!)
  const yScale = useYScale(series.yAxisId!)
  const clipPathId = `linear-regression-clip-${useId()}`

  const { m, b } = linearRegression(series.data ?? [])

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
        <text x={x1} y={y1}>
          {m}
        </text>
      </g>
    </Fragment>
  )
}

function linearRegression(points: ReadonlyArray<{ x: number; y: number }>) {
  const n = points.length

  // Calculate sums
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0

  for (let i = 0; i < n; i += 1) {
    const x = points[i].x
    const y = points[i].y
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }

  // Calculate slope (m) and intercept (b)
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const b = (sumY - m * sumX) / n

  return { m, b }
}
