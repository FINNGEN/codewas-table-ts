import { useState, type Dispatch, type SetStateAction } from "react"
import { FormControl, Grid, InputLabel, MenuItem, Select } from "@mui/material"
import { DuckDbScatter } from "./DuckDbScatter"
import type { ChartMode, ChartScope, ConceptSummaryRow } from "./types"
import { DuckDbOverview } from "./DuckDbOverview"
import { Map, ScatterPlotSharp } from "@mui/icons-material"

export function DuckDbCharts({
  rows,
  chartLoading,
  chartScope,
  setChartScope,
  onSelectConcept,
}: {
  rows: ConceptSummaryRow[]
  chartLoading: boolean
  chartScope: ChartScope
  setChartScope: Dispatch<SetStateAction<ChartScope>>
  onSelectConcept: (rowKey: string) => void
}) {
  const [chartMode, setChartMode] = useState<ChartMode>("heatmap")

  const sharedControls = (
    <>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <FormControl fullWidth size={"small"}>
          <InputLabel id="duckdb-chart-scope-label">Chart Scope</InputLabel>
          <Select
            labelId="duckdb-chart-scope-label"
            value={chartScope}
            label="Chart Scope"
            onChange={(event) => setChartScope(event.target.value as ChartScope)}
          >
            <MenuItem value="filtered">Filtered concepts</MenuItem>
            <MenuItem value="all">All concepts</MenuItem>
          </Select>
        </FormControl>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <FormControl fullWidth size={"small"}>
          <InputLabel id="duckdb-chart-mode-label">Chart Mode</InputLabel>
          <Select
            labelId="duckdb-chart-mode-label"
            value={chartMode}
            label="Chart Mode"
            onChange={(event) => setChartMode(event.target.value as ChartMode)}
          >
            {/* Icon alignment (open + closed) is handled globally by the theme - see App.tsx. */}
            <MenuItem value="heatmap">
              <Map sx={{ fontSize: 16 }} />
              Heatmap
            </MenuItem>
            <MenuItem value="scatter">
              <ScatterPlotSharp sx={{ fontSize: 16 }} />
              Scatter
            </MenuItem>
          </Select>
        </FormControl>
      </Grid>
    </>
  )

  return chartMode === "scatter" ? (
    <DuckDbScatter rows={rows} chartLoading={chartLoading} sharedControls={sharedControls} />
  ) : (
    <DuckDbOverview
      rows={rows}
      chartLoading={chartLoading}
      onSelectConcept={onSelectConcept}
      sharedControls={sharedControls}
    />
    // <DuckDbHeatmap
    //   rows={rows}
    //   chartLoading={chartLoading}
    //   onSelectConcept={onSelectConcept}
    //   sharedControls={sharedControls}
    // />
  )
}
