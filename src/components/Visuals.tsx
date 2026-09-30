// visuals.tsx - lightweight inline charts, no extra charting library needed
import {
  Box,
  Typography,
  Tooltip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material"
import type { BinaryDistribution, DistributionRow, SummaryStats } from "../utils/types"
import { scaleOrdinal, scaleLinear } from "d3-scale"
import { schemeTableau10 } from "d3-scale-chromatic"
import { useTheme } from "@mui/material/styles"

const casesColor = "cases.main"
const controlsColor = "controls.main"

// ─── MeanComparisonChart ──────────────────────────────────────────────────
//
// Renders a small dot-and-line chart comparing cases vs controls means.
// Uses an SVG so it's crisp at any size with zero dependencies.
//
// Layout (all values mapped into a 0-100 px range):
//   [min anchor]----[cases dot]----[controls dot]----[max anchor]
//
// The +/-SD is shown as a shaded band around each dot.

interface GenericTableProps<T extends object> {
  rows: T[]
  size?: "small" | "medium"
  rowColor?: (row: T) => string
}

function GenericTable<T extends object>({ rows, size = "small", rowColor }: GenericTableProps<T>) {
  if (rows.length === 0) return null

  const headers = Object.keys(rows[0]) as (keyof T)[]

  return (
    <Box>
      <Table size={size}>
        <TableHead>
          <TableRow>
            {headers.map((header) => (
              <TableCell key={String(header)} sx={{ color: "primary.contrastText" }}>
                {String(header)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow
              key={i}
              sx={{
                "&:last-child td, &:last-child th": { border: 0 },
                ...(rowColor && {
                  background: `${rowColor(row)}`,
                }),
              }}
            >
              {headers.map((header) => (
                <TableCell key={String(header)} sx={{ color: "primary.contrastText" }}>
                  {String(row[header])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}
interface MeanComparisonChartProps {
  stats: SummaryStats
  distributions: DistributionRow[]
  unit?: string // e.g. "y" for years, "d" for days, "" for counts
}

export function MeanComparisonChart({ stats, distributions, unit = "" }: MeanComparisonChartProps) {
  // Read the live theme rather than the raw token object: SVG `fill` can't take a palette
  // path the way `sx` can, and going through the theme is what makes these dots follow the
  // light/dark toggle.
  const theme = useTheme()
  const { meanValueCases, meanValueControls, sdValueCases, sdValueControls } = stats

  // Build a domain that comfortably fits both means +/- their SDs
  const allValues = [
    meanValueCases - sdValueCases,
    meanValueCases + sdValueCases,
    meanValueControls - sdValueControls,
    meanValueControls + sdValueControls,
  ]

  const domainMin = Math.min(...allValues)
  const domainMax = Math.max(...allValues)
  const domainRange = domainMax - domainMin || 1 // avoid /0

  const W = 100 // SVG width
  const H = 40 // SVG height
  const PAD = 12 // left/right padding in px

  const scaleX = scaleLinear()
    .domain([domainMin, domainMax])
    .range([PAD, W - PAD])
  const cx = scaleX(meanValueCases)
  const cx2 = scaleX(meanValueControls)

  // SD band half-widths in px
  const sdW = (sdValueCases / domainRange) * (W - PAD * 2)
  const sdW2 = (sdValueControls / domainRange) * (W - PAD * 2)

  const cy = H / 2

  const fmt1 = (v: number) => (Number.isInteger(v) ? v : v.toFixed(1))

  return (
    <Box sx={{ alignItems: "center", gap: 1, my: 0.5 }}>
      {/* Legend labels */}
      <Box sx={{ display: "none", flexDirection: "row", gap: 2, minWidth: 56 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, my: 0.5 }}>
          <Box
            sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: casesColor, flexShrink: 0 }}
          />
          <Typography variant="caption" noWrap>
            Cases
            {/* {fmt1(meanValueCases)}
            {unit} */}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, my: 0.5 }}>
          <Box
            sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: controlsColor, flexShrink: 0 }}
          />
          <Typography variant="caption" noWrap>
            Control
            {/* {fmt1(meanValueControls)}
            {unit} */}
          </Typography>
        </Box>
      </Box>

      {/* SVG chart */}
      <Tooltip
        title={
          <Box>
            <Typography variant="body2">
              Cases: {fmt1(meanValueCases)}
              {unit} +/- {fmt1(sdValueCases)}
            </Typography>
            <Typography variant="body2">
              Controls: {fmt1(meanValueControls)}
              {unit} +/- {fmt1(sdValueControls)}
            </Typography>
            {distributions && <GenericTable rows={distributions} />}
          </Box>
        }
        arrow
      >
        <svg width={W} height={H} style={{ overflow: "visible", cursor: "default" }}>
          <BoxPlot
            name={"cases"}
            x1={PAD}
            x2={W - PAD}
            cx={cx}
            cy={cy}
            color={theme.palette.cases.main}
            sd={sdW}
          />
          <BoxPlot
            name={"cases"}
            transform={`translate(0, 15)`}
            x1={PAD}
            x2={W - PAD}
            cx={cx2}
            cy={cy}
            color={theme.palette.controls.main}
            sd={sdW2}
          />
        </svg>
      </Tooltip>
    </Box>
  )
}

interface BoxPlotProps {
  name: "cases" | "controls"
  transform?: string
  x1: number
  x2: number
  cx: number
  cy: number
  color: string
  sd: number
  h?: number
}

function BoxPlot({ name, transform = "", x1, x2, cx, cy, color, sd, h = 10 }: BoxPlotProps) {
  return (
    <g className={name} transform={transform}>
      {/* Baseline */}
      <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={color} strokeWidth={1} />
      {/* SD band - cases */}
      <rect
        x={cx - sd}
        y={cy - h / 2}
        width={sd * 2}
        height={h}
        fill={color}
        fillOpacity={0.25}
        rx={2}
      />
      <rect x={cx} y={cy - h / 2} width={2} height={h} fill={color} />

      <rect x={x1} y={cy - h / 2 + 1} width={1} height={h - 2} fill={color} />
      <rect x={x2} y={cy - h / 2 + 1} width={1} height={h - 2} fill={color} />

      {/* Dot - cases */}
      {/* <circle cx={cx} cy={cy} r={5} fill={theme.palette.cases.main} /> */}
    </g>
  )
}

// ─── CategoryBar ─────────────────────────────────────────────────────────
//
// A pair of thin horizontal bars (cases / controls) showing the proportion
// of a category relative to the total for that group.
// Used inside BinaryDistributionTable and future categorical tables.
//
// total = cases total across all rows for normalisation - pass it in so
// the bar widths are comparable across rows.

interface CategoryBarProps {
  caseCount: number
  controlCount: number
  totalCases: number
  totalControls: number
  maxWidth?: number // px, default 80
}

export function CategoryBar({
  caseCount,
  controlCount,
  totalCases,
  totalControls,
  maxWidth = 50,
}: CategoryBarProps) {
  // Proportions 0-1; guard against divide-by-zero
  const casePct = totalCases > 0 ? caseCount / totalCases : 0
  const ctrlPct = totalControls > 0 ? controlCount / totalControls : 0

  const Bar = ({ pct, color, label }: { pct: number; color: string; label: string }) => (
    <Tooltip title={label} arrow placement="top">
      <Box
        sx={{
          width: maxWidth,
          height: 6,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflow: "hidden",
          cursor: "default",
        }}
      >
        <Box
          sx={{
            width: `${pct * 100}%`,
            height: "100%",
            bgcolor: color,
            borderRadius: 1,
            transition: "width 0.3s ease",
          }}
        />
      </Box>
    </Tooltip>
  )

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
      <Bar
        pct={casePct}
        color={casesColor}
        label={`Cases: ${caseCount} / ${totalCases} (${(casePct * 100).toFixed(1)}%)`}
      />
      <Bar
        pct={ctrlPct}
        color={controlsColor}
        label={`Controls: ${controlCount} / ${totalControls} (${(ctrlPct * 100).toFixed(1)}%)`}
      />
    </Box>
  )
}

const CATEGORICAL_VALUES = [
  "Very low",
  "Low",
  "Normal",
  "High",
  "Very high",
  "Abnormal",
  "High abnormal",
  // 'N/A',
] as const

type CategoricalValue = (typeof CATEGORICAL_VALUES)[number]

const colorScale = scaleOrdinal<CategoricalValue, string>()
  .domain(CATEGORICAL_VALUES)
  .range(schemeTableau10)

interface CategoricalDistributionBarProps {
  totalCases: number
  totalControls: number
  distributions: BinaryDistribution[]
}

export function CategoricalDistributionBar({
  totalCases,
  totalControls,
  distributions,
}: CategoricalDistributionBarProps) {
  const distributionsWithPercentage = distributions.map((d) => ({
    value: d.value,
    "case%": Math.round(((d.case * 100) / totalCases) * 100) / 100,
    "control%": Math.round(((d.control * 100) / totalControls) * 100) / 100,
  }))

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}>
      <Tooltip
        title={
          <GenericTable
            rows={distributionsWithPercentage}
            rowColor={(row) => colorScale(row.value as CategoricalValue)}
          />
        }
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {/* Cases bar */}
          <Box
            sx={{ display: "flex", width: "100%", height: 16, borderRadius: 1, overflow: "hidden" }}
          >
            {distributionsWithPercentage.map((d, i) => (
              <Box
                key={i}
                sx={{
                  width: `${d["case%"]}%`,
                  bgcolor: colorScale(d.value as CategoricalValue),
                }}
              />
            ))}
          </Box>

          {/* Controls bar */}
          <Box
            sx={{ display: "flex", width: "100%", height: 16, borderRadius: 1, overflow: "hidden" }}
          >
            {distributionsWithPercentage.map((d, i) => (
              <Box
                key={i}
                sx={{
                  width: `${d["control%"]}%`,
                  bgcolor: colorScale(d.value as CategoricalValue),
                }}
              />
            ))}
          </Box>
        </Box>
      </Tooltip>
    </Box>
  )
}
