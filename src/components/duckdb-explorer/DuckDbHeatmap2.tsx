import { useMemo, useState, type ReactNode } from "react"
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material"
import { AccountTree } from "@mui/icons-material"
import { CHART_BLOCK_FIELD_PREFIX, HEATMAP_BLOCKS } from "./constants"
import {
  getHeatmapHeaderLines,
  matchesHeatmapSearch,
} from "./utils/heatmapUtils"
import { heatmapPatternLevel, patternSwatchStyle } from "./utils/heatmapPatterns"
import {
  clusterHeatmapRows,
  divergingColor,
  getChartMetricValue,
  getDisplayedEffectValue,
  type HeatmapDerived,
} from "./utils/heatmapUtils"
import { formatNumber, negLog10 } from "./utils/utils"
import type {
  ChartBlockKey,
  ChartMetricKey,
  ConceptSummaryRow,
  HierarchySummaryRow,
} from "./types"
import { ChartAboutDialog } from "./ChartAboutDialog"

const SIGNIFICANCE_CUTOFF = 5
// The detailed heatmap is an HTML table rather than a virtualized canvas. Keeping its rendered
// rows bounded prevents a broad chart query from creating hundreds of thousands of DOM nodes.
const HEATMAP_RENDER_ROW_LIMIT = 2000

const METRIC_LABELS: Record<ChartMetricKey, string> = {
  "-log10": "−log10(p)",
  effectSize: "Effect size",
  standardizedEffect: "Standardized effect",
}

type EffectCapMode = "full" | "p95" | "p98" | "p99"
type HeatmapPopulation = "interesting" | "significant" | "all"

function percentile(values: number[], probability: number) {
  if (values.length === 0) return 1
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

type HierarchyContext = {
  short: string
  label: string
  significantDescendants: number
  relatedDescendants: number
}

// DuckDB-WASM may expose numeric query values as scalar values rather than plain
// JavaScript numbers. Normalize at the chart boundary so filtering and drawing
// use exactly the same value.
function chartLogP(row: ConceptSummaryRow, block: ChartBlockKey) {
  const raw = row[
    `${CHART_BLOCK_FIELD_PREFIX[block]}PValue` as keyof ConceptSummaryRow
  ]
  const logP = row[
    `${CHART_BLOCK_FIELD_PREFIX[block]}LogP` as keyof ConceptSummaryRow
  ]
  if (logP != null) {
    const numericLogP = typeof logP === "number" ? logP : Number(logP)
    if (Number.isFinite(numericLogP)) return numericLogP
  }
  if (raw == null) return null
  const numeric = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(numeric) || numeric === 0 ? negLog10(numeric) : null
}

// Effect sizes for Binary and Count are odds ratios, whose neutral value is 1.
// Convert them to log odds ratios so the diverging color scale is centered at 0.
function chartDisplayValue(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  metric: ChartMetricKey,
) {
  const value = getChartMetricValue(row, block, metric)
  if (value == null || !Number.isFinite(value)) return null
  if (metric === "effectSize" && (block === "Binary" || block === "Count")) {
    return value > 0 ? getDisplayedEffectValue(Math.log(value), block) : null
  }
  return metric === "-log10" ? value : getDisplayedEffectValue(value, block)
}

function ancestorIds(row: ConceptSummaryRow) {
  return new Set(
    (row.ancestorConceptIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function hierarchyContextKey(row: ConceptSummaryRow, block: ChartBlockKey) {
  return `${row.countMode}|${row.conceptId}|${hierarchyAnalysisType(block)}`
}

function effectDirection(row: ConceptSummaryRow, block: ChartBlockKey) {
  const effect = row[`${block === "Count" ? "counts" : block.toLowerCase()}EffectSize` as keyof ConceptSummaryRow]
  if (typeof effect !== "number" || !Number.isFinite(effect)) return null
  if (block === "Binary" || block === "Count") {
    return effect > 1 ? "positive" : effect < 1 ? "negative" : null
  }
  return effect > 0 ? "positive" : effect < 0 ? "negative" : null
}

function getHierarchyContext(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  allRows: ConceptSummaryRow[],
): HierarchyContext {
  const descendants = allRows.filter(
    (candidate) =>
      candidate.countMode === row.countMode &&
      candidate.conceptId !== row.conceptId &&
      ancestorIds(candidate).has(String(row.conceptId)),
  )
  const significantDescendants = descendants.filter(
    (candidate) => (chartLogP(candidate, block) ?? 0) >= SIGNIFICANCE_CUTOFF,
  )
  const parentSignificant =
    (chartLogP(row, block) ?? 0) >= SIGNIFICANCE_CUTOFF

  if (descendants.length === 0) {
    return {
      short: "-",
      label: "No exported related descendants",
      significantDescendants: 0,
      relatedDescendants: 0,
    }
  }

  if (parentSignificant && significantDescendants.length === 0) {
    return {
      short: "P",
      label: "Parent signal without significant related descendants",
      significantDescendants: 0,
      relatedDescendants: descendants.length,
    }
  }
  if (!parentSignificant && significantDescendants.length > 0) {
    return {
      short: "D",
      label: "Descendant signal without significant parent",
      significantDescendants: significantDescendants.length,
      relatedDescendants: descendants.length,
    }
  }
  if (!parentSignificant && significantDescendants.length === 0) {
    return {
      short: "N",
      label: "Neither parent nor related descendants significant",
      significantDescendants: 0,
      relatedDescendants: descendants.length,
    }
  }
  if (parentSignificant && significantDescendants.length === 1) {
    return {
      short: "1",
      label: "One significant related descendant",
      significantDescendants: 1,
      relatedDescendants: descendants.length,
    }
  }

  const directions = new Set(
    significantDescendants.map((candidate) => effectDirection(candidate, block)).filter(Boolean),
  )
  if (directions.has("positive") && directions.has("negative")) {
    return {
      short: "M",
      label: "Mixed significant descendant directions",
      significantDescendants: significantDescendants.length,
      relatedDescendants: descendants.length,
    }
  }
  return {
    short: "C",
    label: "Coherent significant related descendants",
    significantDescendants: significantDescendants.length,
    relatedDescendants: descendants.length,
  }
}

function getHierarchyContextFromDescendants(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  descendants: ConceptSummaryRow[],
): HierarchyContext {
  const significantDescendants = descendants.filter(
    (candidate) => (chartLogP(candidate, block) ?? 0) >= SIGNIFICANCE_CUTOFF,
  )
  const parentSignificant = (chartLogP(row, block) ?? 0) >= SIGNIFICANCE_CUTOFF

  if (descendants.length === 0) {
    return { short: "-", label: "No exported related descendants", significantDescendants: 0, relatedDescendants: 0 }
  }
  if (parentSignificant && significantDescendants.length === 0) {
    return { short: "P", label: "Parent signal without significant related descendants", significantDescendants: 0, relatedDescendants: descendants.length }
  }
  if (!parentSignificant && significantDescendants.length > 0) {
    return { short: "D", label: "Descendant signal without significant parent", significantDescendants: significantDescendants.length, relatedDescendants: descendants.length }
  }
  if (!parentSignificant) {
    return { short: "N", label: "Neither parent nor related descendants significant", significantDescendants: 0, relatedDescendants: descendants.length }
  }
  if (significantDescendants.length === 1) {
    return { short: "1", label: "One significant related descendant", significantDescendants: 1, relatedDescendants: descendants.length }
  }
  const directions = new Set(
    significantDescendants.map((candidate) => effectDirection(candidate, block)).filter(Boolean),
  )
  return directions.has("positive") && directions.has("negative")
    ? { short: "M", label: "Mixed significant descendant directions", significantDescendants: significantDescendants.length, relatedDescendants: descendants.length }
    : { short: "C", label: "Coherent significant related descendants", significantDescendants: significantDescendants.length, relatedDescendants: descendants.length }
}

function hierarchyAnalysisType(block: ChartBlockKey) {
  if (block === "Count") return "Counts"
  if (block === "Age") return "AgeFirstEvent"
  if (block === "Days") return "DaysToFirstEvent"
  return block
}

function findStoredHierarchySummary(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  hierarchySummaryRows: HierarchySummaryRow[],
) {
  return hierarchySummaryRows.find(
    (candidate) =>
      candidate.parentConceptId === row.conceptId &&
      candidate.countMode === row.countMode &&
      candidate.analysisType === hierarchyAnalysisType(block),
  )
}

function hierarchyContextFromSummary(summary: HierarchySummaryRow | undefined): HierarchyContext | null {
  if (!summary || !summary.hierarchyPattern) return null
  const pattern = summary.hierarchyPattern
  let short = "N"
  let label = pattern
  if (pattern === "parent signal without significant descendants" || pattern === "parent association without significant descendants") {
    short = "P"
    label = "Parent signal without significant related descendants"
  } else if (pattern === "coherent parent/descendants") {
    short = "C"
    label = "Coherent significant related descendants"
  } else if (pattern === "mixed/confusing descendants") {
    short = "M"
    label = "Mixed significant descendant directions"
  } else if (pattern === "one significant descendant" || pattern === "one significant descendant association") {
    short = "1"
    label = "One significant related descendant"
  } else if (pattern === "descendant-only signal" || pattern === "descendant-only association") {
    short = "D"
    label = "Descendant signal without significant parent"
  } else if (pattern === "parent and descendant association") {
    short = "A"
    label = "Parent and descendant association"
  } else if (pattern === "neither parent nor descendants significant") {
    short = "N"
    label = "Neither parent nor related descendants significant"
  }
  return {
    short,
    label,
    significantDescendants: summary.nSignificantDescendants ?? 0,
    relatedDescendants: summary.nRelatedDescendants ?? 0,
  }
}

function storedHierarchyContext(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  hierarchySummaryRows: HierarchySummaryRow[],
): HierarchyContext | null {
  return hierarchyContextFromSummary(findStoredHierarchySummary(row, block, hierarchySummaryRows))
}

function isHierarchyInteresting(context: HierarchyContext) {
  return ["P", "C", "D", "1", "M", "A"].includes(context.short)
}

function conceptLabel(row: ConceptSummaryRow, includeMode: boolean) {
  const name = row.conceptName ?? String(row.conceptId)
  const code = row.conceptCode ?? String(row.conceptId)
  return includeMode ? `${name} (${code}) [${row.countMode}]` : `${name} (${code})`
}

function HierarchyDialog({
  selection,
  rows,
  hierarchySummaryRows,
  onClose,
}: {
  selection: { row: ConceptSummaryRow; block: ChartBlockKey | null } | null
  rows: ConceptSummaryRow[]
  hierarchySummaryRows: HierarchySummaryRow[]
  onClose: () => void
}) {
  if (!selection) return null
  const { row, block } = selection
  const descendants = rows.filter(
    (candidate) =>
      candidate.countMode === row.countMode &&
      candidate.conceptId !== row.conceptId &&
      ancestorIds(candidate).has(String(row.conceptId)),
  )
  const blocks = block ? [block] : HEATMAP_BLOCKS

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Hierarchy details: {conceptLabel(row, false)}
        {block ? ` | ${block}` : ""} ({row.countMode} mode)
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          <b>{row.countMode} mode</b> describes how this CodeWAS result was calculated; in
          descendant mode, descendant records are included in the concept analysis. The tables
          below compare this selected concept (the hierarchy&apos;s focal “parent”) with the related
          descendants included in the result.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Analysis</TableCell>
              <TableCell>Focal concept -log10(p)</TableCell>
              <TableCell>Focal concept standardized effect</TableCell>
              <TableCell>Significant related descendants</TableCell>
              <TableCell>Strongest descendant</TableCell>
              <TableCell>Pattern</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {blocks.map((analysis) => {
              const context =
                storedHierarchyContext(row, analysis, hierarchySummaryRows) ??
                getHierarchyContext(row, analysis, rows)
              const stored = findStoredHierarchySummary(row, analysis, hierarchySummaryRows)
              const significant = stored
                ? []
                : descendants.filter(
                    (candidate) => (chartLogP(candidate, analysis) ?? 0) >= SIGNIFICANCE_CUTOFF,
                  )
              const strongest = stored
                ? null
                : [...significant].sort(
                    (left, right) =>
                      (chartLogP(right, analysis) ?? 0) - (chartLogP(left, analysis) ?? 0),
                  )[0]
              const significantCount = stored
                ? stored.nSignificantDescendants ?? 0
                : significant.length
              const relatedCount = stored
                ? stored.nRelatedDescendants ?? 0
                : descendants.length
              const parentLogP = stored?.parentLogP ?? chartLogP(row, analysis)
              const parentEffect = getChartMetricValue(row, analysis, "standardizedEffect")
              return (
                <TableRow key={analysis}>
                  <TableCell>{analysis}</TableCell>
                  <TableCell>{parentLogP == null ? "N/A" : formatNumber(parentLogP, 2)}</TableCell>
                  <TableCell>{parentEffect == null ? "N/A" : formatNumber(parentEffect, 2)}</TableCell>
                  <TableCell>{significantCount} of {relatedCount}</TableCell>
                  <TableCell>
                    {stored
                      ? stored.strongestDescendantName
                        ? `${stored.strongestDescendantName} (${formatNumber(stored.strongestDescendantLogP ?? 0, 2)})`
                        : "None"
                      : strongest
                        ? `${strongest.conceptName ?? strongest.conceptId} (${formatNumber(chartLogP(strongest, analysis) ?? 0, 2)})`
                        : "None"}
                  </TableCell>
                  <TableCell>{context.label}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
          Focal concept and related descendant results
        </Typography>
        {descendants.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No related descendants are available in the loaded CodeWAS results for this focal
            concept and count mode.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Analysis</TableCell>
                  <TableCell>Concept</TableCell>
                  <TableCell>Relationship</TableCell>
                  <TableCell>-log10(p)</TableCell>
                  <TableCell>Standardized effect</TableCell>
                  <TableCell>Effect size / OR</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[row, ...descendants].flatMap((concept) =>
                  blocks.map((analysis) => {
                    const standardizedEffect = getChartMetricValue(
                      concept,
                      analysis,
                      "standardizedEffect",
                    )
                    const effectSize = getChartMetricValue(concept, analysis, "effectSize")
                    return (
                      <TableRow key={`${concept.rowKey}-${analysis}`}>
                        <TableCell>{analysis}</TableCell>
                        <TableCell>{conceptLabel(concept, false)}</TableCell>
                        <TableCell>{concept.conceptId === row.conceptId ? "Focal concept" : "Descendant"}</TableCell>
                        <TableCell>{chartLogP(concept, analysis) == null ? "N/A" : formatNumber(chartLogP(concept, analysis) ?? 0, 2)}</TableCell>
                        <TableCell>{standardizedEffect == null ? "N/A" : formatNumber(standardizedEffect, 2)}</TableCell>
                        <TableCell>{effectSize == null ? "N/A" : formatNumber(effectSize, 2)}</TableCell>
                      </TableRow>
                    )
                  }),
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DuckDbHeatmap2({
  rows,
  hierarchySummaryRows,
  chartLoading,
  onSelectConcept,
  sharedControls,
}: {
  rows: ConceptSummaryRow[]
  hierarchySummaryRows: HierarchySummaryRow[]
  chartLoading: boolean
  onSelectConcept: (rowKey: string) => void
  sharedControls: ReactNode
}) {
  const [population, setPopulation] = useState<HeatmapPopulation>("significant")
  const [searchText, setSearchText] = useState("")
  const [metric, setMetric] = useState<ChartMetricKey>("standardizedEffect")
  const [effectCapMode, setEffectCapMode] = useState<EffectCapMode>("p95")
  const [clusterRows, setClusterRows] = useState(false)
  const [hierarchySelection, setHierarchySelection] = useState<{
    row: ConceptSummaryRow
    block: ChartBlockKey | null
  } | null>(null)
  const showHierarchyMarkers = population !== "significant"

  const rowsWithEvidence = useMemo(
    () =>
      rows.filter((row) =>
        HEATMAP_BLOCKS.some(
          (block) => (chartLogP(row, block) ?? 0) >= SIGNIFICANCE_CUTOFF,
        ),
      ),
    [rows],
  )

  // Build hierarchy relationships once. The previous implementation scanned every chart row for
  // every concept/analysis cell, which becomes quadratic when a result file has no precomputed
  // hierarchySummary table. This index is linear in the loaded rows and ancestor links.
  const hierarchyContexts = useMemo(() => {
    const contexts = new Map<string, HierarchyContext>()
    if (!showHierarchyMarkers) return contexts

    const summariesByKey = new Map<string, HierarchySummaryRow>()
    for (const summary of hierarchySummaryRows) {
      summariesByKey.set(
        `${summary.countMode}|${summary.parentConceptId}|${summary.analysisType}`,
        summary,
      )
    }
    const descendantsByParent = new Map<string, ConceptSummaryRow[]>()
    for (const row of rows) {
      for (const ancestorId of ancestorIds(row)) {
        const key = `${row.countMode}|${ancestorId}`
        const descendants = descendantsByParent.get(key) ?? []
        descendants.push(row)
        descendantsByParent.set(key, descendants)
      }
    }
    for (const row of rows) {
      const descendants = descendantsByParent.get(`${row.countMode}|${row.conceptId}`) ?? []
      for (const block of HEATMAP_BLOCKS) {
        const key = hierarchyContextKey(row, block)
        contexts.set(
          key,
          hierarchyContextFromSummary(summariesByKey.get(key)) ??
            getHierarchyContextFromDescendants(row, block, descendants),
        )
      }
    }
    return contexts
  }, [hierarchySummaryRows, rows, showHierarchyMarkers])

  const rowsWithInterestingHierarchy = useMemo(
    () =>
      showHierarchyMarkers
        ? rows.filter((row) =>
            HEATMAP_BLOCKS.some((block) => {
              const context = hierarchyContexts.get(hierarchyContextKey(row, block))
              return context != null && isHierarchyInteresting(context)
            }),
          )
        : [],
    [hierarchyContexts, rows, showHierarchyMarkers],
  )

  const baseDisplayRows = useMemo(() => {
    const populationRows =
      population === "interesting"
        ? rowsWithInterestingHierarchy
        : population === "significant"
          ? rowsWithEvidence
          : rows
    return populationRows
      .filter((row) => matchesHeatmapSearch(row, searchText))
      .sort((left, right) => {
        const leftScore = HEATMAP_BLOCKS.reduce(
          (score, block) => Math.max(score, chartLogP(left, block) ?? 0),
          0,
        )
        const rightScore = HEATMAP_BLOCKS.reduce(
          (score, block) => Math.max(score, chartLogP(right, block) ?? 0),
          0,
        )
        return rightScore - leftScore
      })
  }, [population, rows, rowsWithEvidence, rowsWithInterestingHierarchy, searchText])

  const maxByBlock = useMemo(() => {
    const result = new Map<ChartBlockKey, number>()
    for (const block of HEATMAP_BLOCKS) {
      const values = rows
        .map((row) => chartDisplayValue(row, block, metric))
        .filter((value): value is number => value != null && Number.isFinite(value))
        .map((value) => metric === "-log10" ? value : Math.abs(value))
      const fullMaximum = values.reduce((maximum, value) => Math.max(maximum, value), 0)
      const blockMaximum = metric === "-log10"
        ? fullMaximum
        : effectCapMode === "full"
          ? fullMaximum
          : percentile(values, Number(effectCapMode.slice(1)) / 100)
      result.set(
        block,
        Math.max(1, blockMaximum),
      )
    }
    return result
  }, [effectCapMode, metric, rows])

  const includeMode = new Set(rows.map((row) => row.countMode)).size > 1

  const displayRows = useMemo(() => {
    if (!clusterRows || baseDisplayRows.length < 3) return baseDisplayRows

    // Cluster on the values currently shown in the cells, including the display convention
    // that reverses negative timing effects so earlier occurrence aligns with positive effects.
    const derivedByKey = new Map<string, HeatmapDerived>()
    for (const row of baseDisplayRows) {
      const vector = HEATMAP_BLOCKS.map((block) => {
        const value = chartDisplayValue(row, block, metric)
        return value == null ? 0 : value / Math.max(1, maxByBlock.get(block) ?? 1)
      })
      derivedByKey.set(row.rowKey, {
        logp: HEATMAP_BLOCKS.map((block) => chartLogP(row, block)),
        smd: HEATMAP_BLOCKS.map((block) => getChartMetricValue(row, block, "standardizedEffect")),
        bestScore: Math.max(...vector.map((value) => Math.abs(value)), 0),
        vector,
      })
    }
    return clusterHeatmapRows(baseDisplayRows, derivedByKey, 1500)
  }, [baseDisplayRows, clusterRows, maxByBlock, metric])
  const renderedRows = useMemo(
    () => displayRows.slice(0, HEATMAP_RENDER_ROW_LIMIT),
    [displayRows],
  )

  return (
    <Stack spacing={2}>
      <HierarchyDialog
        selection={hierarchySelection}
        rows={rows}
        hierarchySummaryRows={hierarchySummaryRows}
        onClose={() => setHierarchySelection(null)}
      />
      <Grid container spacing={2} sx={{ p: 1, pt: 2 }}>
        {sharedControls}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            label="Concept search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Filter by concept, source code, or ID"
          />
        </Grid>
        <Grid
          size={{ xs: 12, sm: 6, md: 3 }}
          sx={{ ml: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end" }}
        >
          <ChartAboutDialog title="Heatmap">
            <Typography variant="subtitle2" color="text.primary">What this plot shows</Typography>
            <Typography variant="body2">
              Heatmap shows one row per concept and one column per CodeWAS analysis type. Each cell
              displays the selected result metric. In the hierarchy-focused and full populations,
              the marker additionally summarizes the concept&apos;s parent-descendant context for that
              analysis.
            </Typography>
            <Typography variant="subtitle2" color="text.primary">Controls</Typography>
            <Typography variant="body2">
              <b>Plot scope</b> chooses the concept population. <b>Filtered concepts</b> uses the
              applied table filters; <b>All concepts</b> ignores those column filters. <b>Plot
              type</b> selects Heatmap. <b>Concept search</b> narrows the plotted concepts by
              name, source code, or ID.
            </Typography>
            <Typography variant="body2">
              <b>Concept population</b> defaults to Significant concepts, showing concepts with at
              least one -log10(p) &gt;= 5 result and no hierarchy markers. Significant concepts
              (hierarchy) keeps concepts with at least one P, C, D, 1, M, or A marker and shows
              the hierarchy markers. All concepts shows every plotted concept and also shows the
              hierarchy markers, including N and -. <b>Show</b> chooses -log10(p), Effect size, or
              Standardized effect; it defaults to Standardized effect. <b>Effect scale</b> controls
              the color range for effect metrics. Uncapped uses the full range; percentile options
              limit extreme colors.
            </Typography>
            <Typography variant="subtitle2" color="text.primary">Reading the plot</Typography>
            <Typography variant="body2">
              Each row is a concept and each column is an analysis type. Standardized effects and
              effect sizes use diverging colors; -log10(p) uses a sequential scale. For Binary and
              Count odds ratios, OR = 1 is neutral; for other effects, 0 is neutral. Hover over a
              cell to see its exact value.
            </Typography>
            <Typography variant="body2">
              <b>Example:</b> if Asthma is red in Binary and red in Days to First Event, the
              results suggest more cases with the concept and an earlier first record among cases.
              When markers are enabled, the marker in each cell adds the parent-descendant context
              to that result.
            </Typography>
            <Typography variant="body2">
              For effect colors, timing directions are reversed for display: a negative Age or Days
              effect means earlier occurrence and is therefore shown in the same positive-color
              direction as a positive Binary or Count effect. The raw signed effect is unchanged
              and remains available in the cell details and concept dialog.
            </Typography>
            <Typography variant="body2">
              The marker in each cell summarizes the parent&apos;s result together with its related
              descendants. It is based on the <b>-log10(p) &gt;= 5</b> significance cutoff, not on the
              selected color metric, so it stays the same when you switch between p-value, effect
              size, and standardized effect.
            </Typography>
            <Typography variant="body2">
              <b>P — Parent-only signal:</b> the parent is significant, but none of its related
              descendants are significant.
              <br />
              <b>C — Coherent descendants:</b> the parent and at least two significant descendants
              show the same effect direction.
              <br />
              <b>D — Descendant-only signal:</b> at least one descendant is significant, but the
              parent is not.
              <br />
              <b>1 — One significant descendant:</b> the parent is significant and exactly one
              related descendant is significant.
              <br />
              <b>M — Mixed descendants:</b> the parent is significant and significant descendants
              show opposing effect directions.
              <br />
              <b>A — Categorical association:</b> for categorical results, the parent and at least
              two descendants show significant associations; direction is not assigned.
              <br />
              <b>N — No significant signal:</b> neither the parent nor its related descendants are
              significant.
              <br />
              <b>- — No exported descendants:</b> no related descendants are available in the
              exported CodeWAS result, so descendant comparison is not possible.
            </Typography>
            <Typography variant="body2">
              <b>Cluster concept rows</b> reorders the displayed concepts by similarity across the
              analysis columns, using the values selected in <b>Show</b>. Missing results are used
              as zero for ordering only; the cells remain empty. Clustering changes row order, not
              the results or their colors.
            </Typography>
            <Box sx={{ display: "none" }}>
            <Typography variant="subtitle2" color="text.primary">Inputs</Typography>
            <Typography variant="body2">
              <b>Plot scope</b> chooses Filtered concepts or All concepts from the main viewer.
              <b> Plot type</b> selects Heatmap. <b>Concept search</b> filters by name, source
              code, or concept ID. <b>Concept population</b> shows either Significant concepts
              (at least one -log10(p) &gt;= 5) or All concepts.
            </Typography>
            <Typography variant="subtitle2" color="text.primary">Cell colors</Typography>
            <Typography variant="body2">
              <b>Show</b> chooses the displayed metric and defaults to Standardized effect.
              Standardized effect and Effect size use a diverging scale; -log10(p) uses a
              sequential scale. For Binary and Count odds ratios, OR = 1 is neutral; for other
              effects, 0 is neutral. <b>Effect scale</b> controls the effect color range: Uncapped
              uses the full range, while percentile caps reduce the influence of extreme values.
            </Typography>
            <Typography variant="subtitle2" color="text.primary">Hierarchy markers</Typography>
            <Typography variant="body2">
              Markers summarize the significance pattern for the concept and its exported related
              descendants: <b>P</b> parent signal without significant descendants, <b>C</b>
              coherent descendants, <b>D</b> descendant signal without a significant parent,
              <b> 1</b> one significant descendant, <b>M</b> mixed directions, <b>N</b> neither
              parent nor descendants significant, and <b>-</b> no exported related descendants.
              Markers use -log10(p) &gt;= 5 and do not change when
              the displayed metric changes.
            </Typography>
            <Box sx={{ display: "none" }}>
            <Typography variant="subtitle2" color="text.primary">What this plot shows</Typography>
            <Typography variant="body2">
              Each row is a concept, shown as its concept name and source code. Each column is one
              CodeWAS analysis type: Binary, Count, Age at First Event, Days to First Event,
              Continuous, or Categorical.
            </Typography>
            <Typography variant="body2">
              <b>Plot scope</b> chooses the concepts supplied by the main viewer: Filtered concepts
              respects the active table filters, while All concepts ignores them. <b>Plot type</b>
              selects Heatmap. <b>Concept search</b> filters the supplied concepts by name, source
              code, or concept ID.
            </Typography>

            <Typography variant="subtitle2" color="text.primary">Inputs</Typography>
            <Typography variant="body2">
              <b>Plot scope</b> determines which concepts are supplied from the main viewer:
              Filtered concepts uses the active table filters, while All concepts ignores those
              column filters. <b>Concept population</b> then determines which supplied concepts are
              displayed here: Significant concepts keeps concepts with at least one −log10(p) ≥ 5;
              All concepts keeps every supplied concept. If a p-value filter is already active,
              these choices may overlap.
            </Typography>

            <Typography variant="body2">
              <b>Concept population</b> controls which supplied concepts are displayed:
              Significant concepts keeps concepts with at least one significant analysis
              (−log10(p) ≥ 5), while All concepts keeps every supplied concept. These choices can
              overlap with the main viewer&apos;s active filters.
            </Typography>

            <Typography variant="subtitle2" color="text.primary">Cell colors</Typography>
            <Typography variant="body2">
              The <b>Show</b> selector controls what the cell color represents. −log10(p) uses a
              sequential scale, where stronger color means stronger statistical evidence. Effect
              size and Standardized effect use a diverging scale, with opposite colors indicating
              opposite directions. For Binary and Count odds ratios, the neutral value is OR = 1;
              for other effects, the neutral value is 0. Effect colors can be uncapped or capped at
              the 95th, 98th, or 99th percentile to prevent extreme values from flattening the
              rest of the plot. Hover over a cell to see the exact uncapped value.
            </Typography>
            <Typography variant="body2">
              The <b>Show</b> input defaults to Standardized effect. The <b>Effect scale</b> input
              controls the color range for effect metrics: Uncapped uses the full range, while the
              percentile options reduce the influence of extreme values. Effect scale does not
              apply when Show is −log10(p).
            </Typography>

            <Typography variant="subtitle2" color="text.primary">Hierarchy markers</Typography>
            <Typography variant="body2">
              The letter in each cell summarizes the significance pattern for that concept and
              its exported related descendants in the same analysis. <b>P</b> means a significant
              parent without significant descendants; <b>C</b> means coherent significant
              descendants; <b>D</b> means descendant signal without a significant parent; <b>1</b>
              means one significant related descendant; <b>M</b> means significant descendants
              have mixed directions; and <b>−</b> means no related descendants were exported.
            </Typography>
            <Typography variant="body2">
              The marker is based on the −log10(p) significance cutoff and effect direction. It does
              not change when the displayed color metric is changed.
            </Typography>
            </Box>
            </Box>
          </ChartAboutDialog>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ px: 1, alignItems: "center" }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="heatmap2-population-label">Concept population</InputLabel>
            <Select
              labelId="heatmap2-population-label"
              value={population}
              label="Concept population"
              onChange={(event) => setPopulation(event.target.value as HeatmapPopulation)}
            >
              <MenuItem value="interesting">Significant concepts (hierarchy)</MenuItem>
              <MenuItem value="significant">Significant concepts</MenuItem>
              <MenuItem value="all">All concepts</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="heatmap2-metric-label">Show</InputLabel>
            <Select
              labelId="heatmap2-metric-label"
              value={metric}
              label="Show"
              onChange={(event) => setMetric(event.target.value as ChartMetricKey)}
            >
              {(Object.keys(METRIC_LABELS) as ChartMetricKey[]).map((key) => (
                <MenuItem key={key} value={key}>{METRIC_LABELS[key]}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        {metric !== "-log10" && (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="heatmap2-effect-cap-label">Effect scale</InputLabel>
              <Select
                labelId="heatmap2-effect-cap-label"
                value={effectCapMode}
                label="Effect scale"
                onChange={(event) => setEffectCapMode(event.target.value as EffectCapMode)}
              >
                <MenuItem value="full">Uncapped</MenuItem>
                <MenuItem value="p95">Cap at 95th percentile</MenuItem>
                <MenuItem value="p98">Cap at 98th percentile</MenuItem>
                <MenuItem value="p99">Cap at 99th percentile</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        )}
        <Grid
          size={{ xs: 12, sm: 6, md: 3 }}
          sx={{ ml: "auto", display: "flex", justifyContent: "flex-end" }}
        >
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={clusterRows}
                onChange={(event) => setClusterRows(event.target.checked)}
              />
            }
            label="Cluster concept rows"
          />
        </Grid>
      </Grid>

      <Stack spacing={1.5} sx={{ px: 1 }}>
        {chartLoading && <Alert severity="info">Loading chart concepts from DuckDB...</Alert>}
        <Grid container spacing={2} sx={{ alignItems: "flex-start" }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper sx={{ p: 1.5 }}>
              <TableContainer sx={{ maxHeight: 620 }}>
            <Table stickyHeader size="small" sx={{ "& .MuiTableCell-root": { py: 0.25 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 280, position: "sticky", left: 0, zIndex: 3, backgroundColor: "background.paper" }}>
                    Concept (source code)
                  </TableCell>
                  {HEATMAP_BLOCKS.map((block) => (
                    <TableCell key={block} align="center" sx={{ minWidth: 92, fontSize: "0.78rem" }}>
                      {getHeatmapHeaderLines(block).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {renderedRows.map((row) => (
                  <TableRow key={row.rowKey} hover>
                    <TableCell
                      component="th"
                      scope="row"
                      onClick={() => onSelectConcept(row.rowKey)}
                      sx={{ cursor: "pointer", position: "sticky", left: 0, zIndex: 1, backgroundColor: "background.paper" }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {showHierarchyMarkers && (
                          <IconButton
                            size="small"
                            title="Open hierarchy summary"
                            aria-label={`Open hierarchy summary for ${conceptLabel(row, includeMode)}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              setHierarchySelection({ row, block: null })
                            }}
                          >
                            <AccountTree fontSize="inherit" />
                          </IconButton>
                        )}
                        <span>{conceptLabel(row, includeMode)}</span>
                      </Box>
                    </TableCell>
                    {HEATMAP_BLOCKS.map((block) => {
                      const rawValue = getChartMetricValue(row, block, metric)
                      const value = chartDisplayValue(row, block, metric)
                      const context = showHierarchyMarkers
                        ? hierarchyContexts.get(hierarchyContextKey(row, block))
                        : null
                      const significance = chartLogP(row, block)
                      const level = metric === "-log10" && significance != null
                        ? heatmapPatternLevel(significance, maxByBlock.get(block) ?? 1)
                        : significance == null
                          ? null
                          : 0
                      const effectColor = metric === "-log10" || value == null
                        ? undefined
                        : divergingColor(value / (maxByBlock.get(block) ?? 1))
                      return (
                        <TableCell
                          key={block}
                          align="center"
                          title={`${conceptLabel(row, includeMode)} | ${block}${context ? ` | ${context.label}` : ""} | ${METRIC_LABELS[metric]}: ${rawValue == null ? "N/A" : formatNumber(rawValue, 2)}`}
                          onClick={() => onSelectConcept(row.rowKey)}
                      sx={{ cursor: "pointer", p: 0.25 }}
                        >
                          <Box
                            sx={{
                              ...(metric === "-log10" ? patternSwatchStyle(level ?? 0, 30) : {}),
                              ...(value == null
                                ? { backgroundColor: "#ececec" }
                                : metric === "-log10"
                                  ? {}
                                  : { backgroundColor: effectColor }),
                              minHeight: 18,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: "0.72rem",
                              color: level == null ? "text.disabled" : "text.primary",
                            }}
                          >
                            {!showHierarchyMarkers ? null : level == null ? "-" : (
                              <Box
                                component="button"
                                type="button"
                                title={`Open hierarchy details: ${context?.label ?? "No hierarchy summary"}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setHierarchySelection({ row, block })
                                }}
                                sx={{
                                  border: 0,
                                  background: "transparent",
                                  color: "inherit",
                                  font: "inherit",
                                  fontWeight: "inherit",
                                  cursor: "pointer",
                                  p: 0,
                                }}
                              >
                                {context?.short ?? "-"}
                              </Box>
                            )}
                          </Box>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
                {displayRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={HEATMAP_BLOCKS.length + 1}>
                      No concepts match the current Heatmap population and filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
              </TableContainer>
            </Paper>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Showing {renderedRows.length} of {
                population === "interesting"
                  ? rowsWithInterestingHierarchy.length
                  : population === "significant"
                    ? rowsWithEvidence.length
                    : rows.length
              } concepts
              {population === "interesting"
                ? " with at least one hierarchy-interesting pattern"
                : population === "significant"
                  ? " with at least one significant analysis"
                  : ""}.
              {displayRows.length > renderedRows.length &&
                ` The detailed table is limited to the first ${HEATMAP_RENDER_ROW_LIMIT.toLocaleString()} rows; use concept search or filters to narrow it.`}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" color="text.primary">
                {clusterRows ? "Heatmap view (with clustering)" : "Heatmap view"}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {clusterRows
                  ? `Rows are clustered using ${METRIC_LABELS[metric].toLowerCase()} values across analyses.`
                  : "Rows are ordered by strongest statistical evidence."}
              </Typography>
              {clusterRows && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  Similar cross-analysis profiles are placed next to each other. The grouping uses
                  the displayed values, including the timing-direction convention.
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {displayRows.length} concepts shown · {HEATMAP_BLOCKS.length} analysis columns
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Rows are concepts and columns are analysis types. Significant concepts are shown by
                default without hierarchy markers. Select Significant concepts (hierarchy) to focus
                on concepts with at least one hierarchy-interesting marker.
              </Typography>
              {!showHierarchyMarkers && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Hierarchy markers are hidden for the current <b>Significant concepts</b> view.
                  Select <b>Significant concepts (hierarchy)</b> to show P, C, D, 1, M, A, N, and -
                  markers in the cells and open their hierarchy details.
                </Typography>
              )}
              {showHierarchyMarkers && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  <strong>Hierarchy markers:</strong> P = parent-only signal, C = coherent
                  parent/descendant signal, D = descendant-only signal, 1 = one significant
                  descendant, M = mixed descendant directions, A = categorical association, N = no
                  significant signal, - = no exported related descendants.
                </Alert>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Stack>
    </Stack>
  )
}
