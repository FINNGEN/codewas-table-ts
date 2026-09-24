import type { MRT_ColumnFiltersState } from "material-react-table"
import { dataHues } from "../../theme"
import type { AnalysisBlock, ChartBlockKey } from "./types"

// Tables written by the optional AI review pass. Only some exports carry them, so every reference
// has to be gated on presence (dataSource.tableCounts) — naming a missing table is a hard SQL error,
// not an empty result. `aiPrioritization` holds the per-concept verdicts the explorer reads;
// `aiPrioritizationInfo` holds run-level metadata (cost, timings) and is not surfaced yet.
export const AI_PRIORITIZATION_TABLE = "aiPrioritization"
export const AI_PRIORITIZATION_INFO_TABLE = "aiPrioritizationInfo"

// Sentinel values for the AI category selector, kept out of the real category value space (which is
// lowercase words like "expected"). ALL disables the filter; ANY keeps every AI-reviewed row
// regardless of which category it landed in.
export const AI_CATEGORY_ALL = "all"
export const AI_CATEGORY_ANY = "__any"

export const DISPLAY_ANALYSIS_TYPES: AnalysisBlock[] = [
  "Binary",
  "Counts",
  "AgeFirstEvent",
  "DaysToFirstEvent",
  "Continuous",
  "Categorical",
]

export const CHART_BLOCK_FIELD_PREFIX: Record<ChartBlockKey, string> = {
  Binary: "binary",
  Count: "counts",
  Age: "age",
  Days: "days",
  Continuous: "continuous",
  Categorical: "categorical",
}

export const HEATMAP_BLOCKS: ChartBlockKey[] = [
  "Binary",
  "Count",
  "Age",
  "Days",
  "Continuous",
  "Categorical",
]

export const DEFAULT_COLUMN_FILTERS: MRT_ColumnFiltersState = [
  { id: "binaryCasesControl", value: ">= 5" },
  { id: "binaryLogP", value: ">= 5" },
]

// Max rows fetched from DuckDB for chart views. TSV exports bypass this. The heatmap uses a lean
// projection (buildHeatmapQuery) and canvas virtualization, so it can handle tens of thousands.
export const CHART_ROWS_LIMIT = 50000
// Greedy nearest-neighbor clustering is O(n²); only the top-N by evidence are clustered, the rest
// are appended by strength. Keeps the "clustered" order mode responsive at scale.
export const HEATMAP_MAX_CLUSTER_ROWS = 1500
// @mui/x-charts ScatterChart renders SVG — no virtualization.
export const SCATTER_POINT_CAP = 3000

// DuckDbOverview (transposed population heatmap): concepts run along X, analyses along Y. The whole
// population is shown at once by aggregating adjacent concepts into pixel-column buckets; zoom resolves
// detail. Cap the in-memory concept population so the bucket pass stays trivial.
export const OVERVIEW_MAX_CONCEPTS = 5000
// Minimum drawn width (CSS px) of one aggregated column. plotWidth / MIN_COL_PX caps the bucket count.
export const OVERVIEW_MIN_COL_PX = 3
// Once a column is at least this wide, every column is labelled (horizontal text needs room to read);
// narrower than this, only the hovered/expanded column is labelled.
export const OVERVIEW_MIN_LABEL_PX = 65
// Color ramp behind the heatmap's color *fallback* (HEATMAP_ENCODING in utils/heatmapPatterns) and the
// swatches sampled from it. Give the two ends; everything interpolates between (see rampColor in
// utils/heatmapUtils). Cells themselves are encoded with texture — the ramp is not on that path.
// The ramp shows evidence strength (-log10 p), so it runs along the p-value hue.
export const OVERVIEW_RAMP_FROM = dataHues.pvalueFaint
export const OVERVIEW_RAMP_TO = dataHues.pvalue
// SMD color modes use a diverging blue ← neutral → red ramp instead (SMD is signed; purple stays
// reserved for p-values). Capped mode clamps SMD to ±OVERVIEW_SMD_CAP; row-scaled mode colors the
// per-analysis z-score and saturates at ±OVERVIEW_ROW_Z_LIMIT.
export const OVERVIEW_DIVERGING_NEGATIVE = "#2872d9"
export const OVERVIEW_DIVERGING_MID = "#F5F5F5"
export const OVERVIEW_DIVERGING_POSITIVE = "#d6372c"
export const OVERVIEW_SMD_CAP = 5
// Cells with no value. A mid, chroma-free grey: clearly apart from the diverging ramp's near-white
// midpoint (SMD ≈ 0) and from the p-value ramp's faint end, and legible on both light and dark paper.
export const HEATMAP_EMPTY_COLOR = "#ececec"
export const OVERVIEW_ROW_Z_LIMIT = 3
// The number of steps in both heatmap scales — and so the number of draggable breakpoints on the
// global scale (steps - 1) — comes from HEATMAP_PATTERNS.length in utils/heatmapPatterns.
