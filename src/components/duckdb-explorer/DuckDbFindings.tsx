import { useMemo, useState, type ReactNode } from "react"
import {
  Box,
  Breadcrumbs,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material"
import { AccountTreeRounded, ChevronRight, Insights } from "@mui/icons-material"
import { ChartAboutDialog } from "./ChartAboutDialog"
import { HEATMAP_BLOCKS } from "./constants"
import type { ChartBlockKey, ConceptSummaryRow } from "./types"
import { getChartMetricValue, getSmdValue } from "./utils/heatmapUtils"
import { buildHierarchyIndex } from "./utils/hierarchyUtils"

type FindingsRankMode = "evidence" | "effect" | "breadth"
type FindingsOrganizeMode = "ranked" | "clustered"
type FindingsClusterCount = "auto" | 3 | 5 | 8
type ParentResultMode = "own" | "subtree"
type EffectCapMode = "full" | "p95" | "p98" | "p99"

type FindingsAgg = {
  ownLogp: (number | null)[]
  ownSmd: (number | null)[]
  maxLogp: (number | null)[]
  maxLogpSource: (string | null)[]
  strongestSmd: (number | null)[]
  strongestSmdLogp: (number | null)[]
  strongestSmdSource: (string | null)[]
  count: number
}

type FindingsNode = {
  row: ConceptSummaryRow
  agg: FindingsAgg
  childCount: number
}

type DisplayEntry =
  | { type: "group"; key: string; label: string; count: number; rowKeys: string[] }
  | { type: "node"; key: string; node: FindingsNode }

const BLOCK_LABELS: Record<ChartBlockKey, string> = {
  Binary: "Binary",
  Count: "Count",
  Age: "Age first event",
  Days: "Days first event",
  Continuous: "Continuous",
  Categorical: "Categorical",
}

const BLOCK_SHORT_LABELS: Record<ChartBlockKey, string> = {
  Binary: "Binary",
  Count: "Count",
  Age: "Age",
  Days: "Days",
  Continuous: "Continuous",
  Categorical: "Categorical",
}

const EMPTY_AGG: FindingsAgg = {
  ownLogp: HEATMAP_BLOCKS.map(() => null),
  ownSmd: HEATMAP_BLOCKS.map(() => null),
  maxLogp: HEATMAP_BLOCKS.map(() => null),
  maxLogpSource: HEATMAP_BLOCKS.map(() => null),
  strongestSmd: HEATMAP_BLOCKS.map(() => null),
  strongestSmdLogp: HEATMAP_BLOCKS.map(() => null),
  strongestSmdSource: HEATMAP_BLOCKS.map(() => null),
  count: 1,
}

function conceptLabel(row: ConceptSummaryRow) {
  return row.conceptName?.trim() || row.conceptCode?.trim() || String(row.conceptId)
}

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "-"
  const absolute = Math.abs(value)
  if (absolute >= 100) return value.toFixed(0)
  if (absolute >= 10) return value.toFixed(1)
  return value.toFixed(digits)
}

function effectScaleStats(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  const percentile = (p: number) => {
    if (sorted.length === 0) return 1
    const position = (sorted.length - 1) * p
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  }
  return {
    full: sorted.at(-1) ?? 1,
    p95: percentile(0.95),
    p98: percentile(0.98),
    p99: percentile(0.99),
  }
}

function selectedLogp(agg: FindingsAgg, mode: ParentResultMode) {
  return mode === "own" ? agg.ownLogp : agg.maxLogp
}

function selectedSmd(agg: FindingsAgg, mode: ParentResultMode) {
  return mode === "own" ? agg.ownSmd : agg.strongestSmd
}

function nodeBestEvidence(node: FindingsNode, mode: ParentResultMode) {
  return Math.max(0, ...selectedLogp(node.agg, mode).map((value) => value ?? 0))
}

function nodeLargestEffect(node: FindingsNode, mode: ParentResultMode) {
  return Math.max(0, ...selectedSmd(node.agg, mode).map((value) => Math.abs(value ?? 0)))
}

function nodeBreadth(node: FindingsNode, mode: ParentResultMode, cutoff: number) {
  return selectedLogp(node.agg, mode).reduce<number>(
    (count, value) => count + Number(value != null && value >= cutoff),
    0,
  )
}

type ProfileVector = (number | null)[]

function percentile(values: number[], p: number) {
  if (values.length === 0) return 1
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function buildProfileVectors(nodes: FindingsNode[], mode: ParentResultMode, evidenceCutoff: number) {
  const scales = HEATMAP_BLOCKS.map((_, index) => {
    const values = nodes
      .map((node) => selectedSmd(node.agg, mode)[index])
      .filter((value): value is number => value != null && Number.isFinite(value) && value !== 0)
      .map(Math.abs)
    return Math.max(percentile(values, 0.9), Number.EPSILON)
  })

  return nodes.map((node): ProfileVector => {
    const effects = selectedSmd(node.agg, mode)
    const evidence = mode === "own" ? node.agg.ownLogp : node.agg.strongestSmdLogp
    return HEATMAP_BLOCKS.map((_, index) => {
      const effect = effects[index]
      const logp = evidence[index]
      if (effect == null || logp == null || !Number.isFinite(effect) || !Number.isFinite(logp)) return null
      const scaledEffect = Math.max(-1, Math.min(1, effect / scales[index]))
      const evidenceWeight = Math.max(0, Math.min(1, logp / Math.max(evidenceCutoff, Number.EPSILON)))
      return scaledEffect * evidenceWeight
    })
  })
}

function profileDistance(left: ProfileVector, right: ProfileVector) {
  let squaredDifference = 0
  let compared = 0
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (leftValue == null && rightValue == null) continue
    let difference: number
    if (leftValue == null || rightValue == null) {
      const available = Math.abs(leftValue ?? rightValue ?? 0)
      difference = 0.5 + 0.5 * available
    } else {
      difference = leftValue - rightValue
    }
    squaredDifference += difference * difference
    compared++
  }
  return compared === 0 ? 0 : Math.sqrt(squaredDifference / compared)
}

function silhouetteScore(groups: number[][], distances: number[][]) {
  if (groups.length < 2) return -1
  const groupByIndex = new Map<number, number>()
  groups.forEach((group, groupIndex) => group.forEach((index) => groupByIndex.set(index, groupIndex)))
  let total = 0
  let count = 0
  for (const [index, ownGroupIndex] of groupByIndex) {
    const ownGroup = groups[ownGroupIndex]
    if (ownGroup.length <= 1) {
      count++
      continue
    }
    const within = ownGroup
      .filter((other) => other !== index)
      .reduce((sum, other) => sum + distances[index][other], 0) / (ownGroup.length - 1)
    let nearest = Number.POSITIVE_INFINITY
    groups.forEach((group, groupIndex) => {
      if (groupIndex === ownGroupIndex || group.length === 0) return
      const average = group.reduce((sum, other) => sum + distances[index][other], 0) / group.length
      nearest = Math.min(nearest, average)
    })
    const denominator = Math.max(within, nearest)
    total += denominator > 0 && Number.isFinite(nearest) ? (nearest - within) / denominator : 0
    count++
  }
  return count > 0 ? total / count : -1
}

function clusterProfiles(vectors: ProfileVector[], requestedCount: FindingsClusterCount) {
  const size = vectors.length
  if (size <= 1) return size === 0 ? [] : [[0]]
  const distances = vectors.map((left, leftIndex) =>
    vectors.map((right, rightIndex) => leftIndex === rightIndex ? 0 : profileDistance(left, right)),
  )
  let groups = vectors.map((_, index) => [index])
  const snapshots = new Map<number, number[][]>()
  const largestCandidate = Math.min(8, size - 1)

  while (groups.length > 1) {
    let bestLeft = 0
    let bestRight = 1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let left = 0; left < groups.length - 1; left++) {
      for (let right = left + 1; right < groups.length; right++) {
        let sum = 0
        let pairs = 0
        for (const leftIndex of groups[left]) {
          for (const rightIndex of groups[right]) {
            sum += distances[leftIndex][rightIndex]
            pairs++
          }
        }
        const average = pairs > 0 ? sum / pairs : 0
        if (average < bestDistance) {
          bestDistance = average
          bestLeft = left
          bestRight = right
        }
      }
    }
    const merged = [...groups[bestLeft], ...groups[bestRight]]
    groups = groups.filter((_, index) => index !== bestLeft && index !== bestRight)
    groups.push(merged)
    if (groups.length >= 2 && groups.length <= largestCandidate) {
      snapshots.set(groups.length, groups.map((group) => [...group]))
    }
  }

  if (requestedCount !== "auto") {
    return snapshots.get(Math.min(requestedCount, largestCandidate)) ?? [vectors.map((_, index) => index)]
  }
  let bestGroups = snapshots.get(Math.min(3, largestCandidate)) ?? [vectors.map((_, index) => index)]
  let bestScore = -1
  for (const candidate of snapshots.values()) {
    const score = silhouetteScore(candidate, distances)
    if (score > bestScore) {
      bestScore = score
      bestGroups = candidate
    }
  }
  return bestGroups
}

function clusterProfileLabel(group: number[], vectors: ProfileVector[]) {
  const summaries = HEATMAP_BLOCKS.map((block, analysisIndex) => {
    const values = group
      .map((nodeIndex) => vectors[nodeIndex][analysisIndex])
      .filter((value): value is number => value != null)
    const average = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0
    return { block, average, coverage: values.length / Math.max(group.length, 1) }
  })
    .filter(({ average, coverage }) => Math.abs(average) >= 0.1 && coverage >= 0.25)
    .sort((left, right) => Math.abs(right.average) - Math.abs(left.average))
    .slice(0, 3)

  if (summaries.length === 0) return "Weak or incomplete cross-analysis profile"
  return summaries.map(({ block, average }) =>
    block === "Categorical"
      ? `${BLOCK_SHORT_LABELS[block]} present`
      : `${BLOCK_SHORT_LABELS[block]} ${average < 0 ? "negative" : "positive"}`,
  ).join(" | ")
}

function MiniEffect({
  block,
  effect,
  logp,
  range,
  effectSource,
  evidenceSource,
  onClick,
}: {
  block: ChartBlockKey
  effect: number | null
  logp: number | null
  range: number
  effectSource: string | null
  evidenceSource: string | null
  onClick: () => void
}) {
  if (effect == null && logp == null) {
    return <Typography color="text.disabled" sx={{ textAlign: "center" }}>-</Typography>
  }

  const categorical = block === "Categorical"
  const safeEffect = effect ?? 0
  const normalized = categorical
    ? Math.max(0, Math.min(1, safeEffect / range))
    : Math.max(-1, Math.min(1, safeEffect / range))
  const zeroX = categorical ? 12 : 66
  const endX = categorical ? 120 : 120
  const x = categorical ? zeroX + normalized * (endX - zeroX) : zeroX + normalized * 54
  const saturated = effect != null && Math.abs(effect) > range
  const color = categorical ? "#7957a8" : safeEffect < 0 ? "#2872d9" : "#d6372c"
  const valueText = effect == null
    ? "effect -"
    : `${saturated ? (safeEffect < 0 ? "<= " : ">= ") : ""}${formatNumber(effect)}`
  const tooltip = [
    `${BLOCK_LABELS[block]} standardized effect: ${formatNumber(effect, 3)}`,
    `-log10(p): ${formatNumber(logp, 2)}`,
    effectSource ? `Effect source: ${effectSource}` : null,
    evidenceSource && evidenceSource !== effectSource ? `Evidence source: ${evidenceSource}` : null,
  ].filter(Boolean).join("\n")

  return (
    <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{tooltip}</span>} arrow>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        sx={{
          display: "block",
          width: 132,
          mx: "auto",
          p: 0,
          border: 0,
          background: "none",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <svg width="132" height="26" role="img" aria-label={tooltip}>
          <line x1="12" x2="120" y1="10" y2="10" stroke="#c8d0d8" strokeWidth="1" />
          <line x1={zeroX} x2={zeroX} y1="4" y2="16" stroke="#6b7785" strokeWidth="1" />
          {effect != null && (
            <>
              <line x1={zeroX} x2={x} y1="10" y2="10" stroke={color} strokeWidth="3" />
              {categorical ? (
                <polygon
                  points={`${x},4 ${x + 6},10 ${x},16 ${x - 6},10`}
                  fill={color}
                  stroke={saturated ? "#222" : color}
                  strokeWidth={saturated ? 1.5 : 1}
                />
              ) : (
                <circle
                  cx={x}
                  cy="10"
                  r="5"
                  fill={color}
                  stroke={saturated ? "#222" : "white"}
                  strokeWidth={saturated ? 1.5 : 1}
                />
              )}
            </>
          )}
        </svg>
        <Typography component="span" variant="caption" sx={{ display: "block", lineHeight: 1.05 }}>
          {valueText} | logp {formatNumber(logp, 1)}
        </Typography>
      </Box>
    </Tooltip>
  )
}

function FindingsAbout() {
  return (
    <ChartAboutDialog title="Findings overview">
      <Typography variant="subtitle2">What this plot shows</Typography>
      <Typography variant="body2">
        Each row is one concept and the six analysis columns show its Binary, Count, Age at First
        Event, Days to First Event, Continuous, and Categorical results together. Only concepts at
        the current hierarchy level are compared, so a parent and all of its descendants cannot
        fill the same ranked list.
      </Typography>

      <Typography variant="subtitle2">Choosing which concepts to show</Typography>
      <Typography variant="body2">
        <b>Plot scope</b> applies the shared table filters. <b>Search this level</b> searches only the
        concepts currently being compared. <b>Show</b> limits the ranked result to the top 10, 25, or
        50 concepts; it does not change the underlying results.
      </Typography>
      <Typography variant="body2">
        <b>Rank by</b> determines how concepts at the current hierarchy level are ordered:
      </Typography>
      <Box component="ul" sx={{ my: 0, pl: 3 }}>
        <Typography component="li" variant="body2">
          <b>Strongest evidence anywhere</b> ranks a concept by its largest -log10(p) across the six
          analysis types. For example, a very strong Count result can place a concept near the top
          even when its other analyses are weak. Ties favor the larger absolute standardized effect.
        </Typography>
        <Typography component="li" variant="body2">
          <b>Largest effect anywhere</b> ranks by the largest absolute standardized effect across the
          six analysis types. Large positive and negative effects are treated equally for ranking;
          color and dot direction retain the sign. Ties favor stronger statistical evidence.
        </Typography>
        <Typography component="li" variant="body2">
          <b>Broadest evidence</b> ranks by how many of the six analyses meet the selected evidence
          cutoff. For example, a concept meeting the cutoff in Binary, Count, and Age has breadth 3.
          Ties favor the concept with the strongest single -log10(p).
        </Typography>
      </Box>

      <Typography variant="subtitle2">Organizing similar cross-analysis profiles</Typography>
      <Typography variant="body2">
        <b>Organize concepts</b> is separate from ranking. <b>Ranked list</b> keeps the selected concepts
        in rank order. <b>Similar cross-analysis profiles</b> first takes the top concepts selected by
        Rank by and Show, then uses hierarchical clustering to group concepts with similar patterns
        across the six analyses. Rank by still determines which concepts enter the clustering and
        their order within each cluster.
      </Typography>
      <Typography variant="body2">
        Clustering converts every concept into a six-number profile. For each analysis <b>j</b>, the
        scale is the 90th percentile of the nonzero absolute effects among the concepts being
        clustered. Each concept-analysis value is calculated as:
      </Typography>
      <Box
        component="code"
        sx={{ display: "block", px: 1.5, py: 1, bgcolor: "action.hover", borderRadius: 1 }}
      >
        scaled effect = clamp(effect / analysis scale, -1, +1)
        <br />
        evidence weight = clamp(-log10(p) / evidence cutoff, 0, 1)
        <br />
        clustering value = scaled effect x evidence weight
      </Box>
      <Typography variant="body2">
        <b>Example:</b> suppose a Binary effect is +0.30, the Binary 90th-percentile scale is 0.60,
        -log10(p) is 2, and the evidence cutoff is 5. The scaled effect is 0.30 / 0.60 = 0.50, the
        evidence weight is 2 / 5 = 0.40, and the clustering value is +0.50 x 0.40 = +0.20. If the
        same effect has -log10(p) at least 5, its weight is 1 and its clustering value is +0.50.
        Thus evidence below the cutoff still contributes, but contributes less; the cutoff is not a
        pass/fail filter for clustering.
      </Typography>
      <Typography variant="body2">
        Scaling is performed separately for each analysis, so a numerically wide analysis cannot
        dominate solely because of its scale. Values beyond the 90th percentile are limited to -1
        or +1 for clustering only. Positive and negative directions are retained. Categorical
        Cramer&apos;s V remains nonnegative because it has no direction. In Strongest in subtree mode,
        each selected effect is weighted using the p-value from the same source concept as that
        effect, even if a different descendant supplies the strongest p-value shown in the table.
      </Typography>
      <Typography variant="body2">
        Concepts are compared using the root-mean-square difference between their available profile
        values, then joined by average-linkage hierarchical clustering. If both concepts are missing
        the same analysis, that analysis is ignored for their comparison. If only one is missing it
        receives a difference penalty from 0.5 to 1.0, increasing with the strength of the observed
        value; therefore missing is not treated as an observed zero.
      </Typography>
      <Typography variant="body2">
        <b>Clusters</b> can request 3, 5, or 8 groups. <b>Automatic</b> compares solutions from 2 through
        8 groups and selects the one with the best average silhouette score, subject to the number of
        displayed concepts. Cluster headings summarize the strongest average components of each
        profile. Click a cluster heading to open its member concepts in the table; remove the cluster
        chip above the table to return to the ordinary table results. The clusters are exploratory
        descriptions of these results, not validated clinical or biological classes.
      </Typography>

      <Typography variant="subtitle2">Parent results and evidence cutoff</Typography>
      <Typography variant="body2">
        <b>Parent result</b> controls the values used by the plot and its ranking. <b>Concept&apos;s own
        result</b> uses the displayed concept&apos;s CodeWAS result. <b>Strongest in subtree</b> searches the
        displayed concept and its loaded descendants separately for each analysis. The strongest
        p-value and largest absolute effect can come from different descendants; the tooltip names
        their sources.
      </Typography>
      <Typography variant="body2">
        <b>Evidence cutoff</b> is a -log10(p) threshold used by Broadest evidence and the Across
        analyses summary. It also defines the evidence level at which a clustering component receives
        full weight; weaker results receive proportionally less weight. It does not remove concepts or
        change their statistics. For reference, -log10(p) 1.3 is approximately p=0.05 and -log10(p) 5
        is p=0.00001.
      </Typography>

      <Typography variant="subtitle2">Moving through the concept hierarchy</Typography>
      <Typography variant="body2">
        The clickable path above the table, beginning with <b>All roots</b>, shows your current
        location in the concept tree. Click a concept name with children to replace the current rows
        with its direct children. Click an earlier name in the path to move back to that level. Click
        a concept without children, or click one of its result plots, to open the detailed concept view.
      </Typography>

      <Typography variant="subtitle2">Reading a result plot</Typography>
      <Typography variant="body2">
        In each analysis cell, the small dot shows the signed standardized effect relative to zero:
        blue and left mean negative, while red and right mean positive. Categorical Cramer&apos;s V is
        unsigned, so it is shown as a purple diamond extending right from zero. The text after
        <b> logp</b> is -log10(p); larger values mean stronger statistical evidence.
      </Typography>
      <Typography variant="body2">
        <b>Effect scale</b> controls how dot positions are scaled across the loaded results. A percentile
        cap prevents a few extreme effects from compressing the other dots; a dot at the capped edge
        may exceed that limit. Capping changes only the display position. The printed value, tooltip,
        detailed result, and ranking continue to use the exact effect.
      </Typography>
      <Typography variant="body2">
        <b>Across analyses</b> reports how many analyses meet the evidence cutoff and identifies the
        analysis with the strongest -log10(p). Use it to distinguish a result driven by one analysis
        from a pattern supported across several analyses.
      </Typography>
    </ChartAboutDialog>
  )
}

export function DuckDbFindings({
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
  const [rankMode, setRankMode] = useState<FindingsRankMode>("evidence")
  const [organizeMode, setOrganizeMode] = useState<FindingsOrganizeMode>("ranked")
  const [clusterCount, setClusterCount] = useState<FindingsClusterCount>("auto")
  const [parentMode, setParentMode] = useState<ParentResultMode>("own")
  const [capMode, setCapMode] = useState<EffectCapMode>("p99")
  const [evidenceCutoff, setEvidenceCutoff] = useState(5)
  const [maxRows, setMaxRows] = useState(25)
  const [searchText, setSearchText] = useState("")
  const [path, setPath] = useState<string[]>([])
  const [previousRows, setPreviousRows] = useState(rows)
  if (previousRows !== rows) {
    setPreviousRows(rows)
    setPath([])
    setSearchText("")
  }

  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.rowKey, row] as const)), [rows])
  const hierarchy = useMemo(() => buildHierarchyIndex(rows), [rows])

  const aggByKey = useMemo(() => {
    const result = new Map<string, FindingsAgg>()
    const visiting = new Set<string>()
    const compute = (rowKey: string): FindingsAgg => {
      const cached = result.get(rowKey)
      if (cached) return cached
      const row = rowByKey.get(rowKey)
      if (!row) return EMPTY_AGG
      const label = `${conceptLabel(row)} (${row.countMode})`
      const ownLogp = HEATMAP_BLOCKS.map((block) => getChartMetricValue(row, block, "-log10"))
      const ownSmd = HEATMAP_BLOCKS.map((block) => getSmdValue(row, block))
      const maxLogp = [...ownLogp]
      const maxLogpSource = ownLogp.map((value) => value == null ? null : label)
      const strongestSmd = [...ownSmd]
      const strongestSmdLogp = ownSmd.map((value, index) => value == null ? null : ownLogp[index])
      const strongestSmdSource = ownSmd.map((value) => value == null ? null : label)
      let count = 1

      if (!visiting.has(rowKey)) {
        visiting.add(rowKey)
        for (const childKey of hierarchy.childRowKeysByParentRowKey.get(rowKey) ?? []) {
          if (childKey === rowKey) continue
          const child = compute(childKey)
          count += child.count
          for (let index = 0; index < HEATMAP_BLOCKS.length; index++) {
            const childLogp = child.maxLogp[index]
            if (childLogp != null && (maxLogp[index] == null || childLogp > (maxLogp[index] as number))) {
              maxLogp[index] = childLogp
              maxLogpSource[index] = child.maxLogpSource[index]
            }
            const childSmd = child.strongestSmd[index]
            if (
              childSmd != null &&
              (strongestSmd[index] == null || Math.abs(childSmd) > Math.abs(strongestSmd[index] as number))
            ) {
              strongestSmd[index] = childSmd
              strongestSmdLogp[index] = child.strongestSmdLogp[index]
              strongestSmdSource[index] = child.strongestSmdSource[index]
            }
          }
        }
        visiting.delete(rowKey)
      }

      const agg = {
        ownLogp,
        ownSmd,
        maxLogp,
        maxLogpSource,
        strongestSmd,
        strongestSmdLogp,
        strongestSmdSource,
        count,
      }
      result.set(rowKey, agg)
      return agg
    }

    for (const row of rows) compute(row.rowKey)
    return result
  }, [hierarchy, rowByKey, rows])

  const scaleStats = useMemo(() => {
    const values: number[] = []
    for (const row of rows) {
      for (const block of HEATMAP_BLOCKS) {
        const value = getSmdValue(row, block)
        if (value != null && value !== 0) values.push(Math.abs(value))
      }
    }
    return effectScaleStats(values)
  }, [rows])
  const effectRange = Math.max(scaleStats[capMode], Number.EPSILON)

  const rootKeys = useMemo(
    () => hierarchy.rootRowKeys.length > 0
      ? hierarchy.rootRowKeys
      : rows.map((row) => row.rowKey),
    [hierarchy, rows],
  )
  const currentParentKey = path.at(-1) ?? null
  const currentKeys = useMemo(
    () => currentParentKey
      ? hierarchy.childRowKeysByParentRowKey.get(currentParentKey) ?? []
      : rootKeys,
    [currentParentKey, hierarchy, rootKeys],
  )

  const currentNodes = useMemo(() => {
    const needle = searchText.trim().toLowerCase()
    return currentKeys
      .map((key) => {
        const row = rowByKey.get(key)
        if (!row) return null
        const searchable = [conceptLabel(row), row.conceptCode ?? "", String(row.conceptId), row.domainId]
          .join(" ")
          .toLowerCase()
        if (needle && !searchable.includes(needle)) return null
        return {
          row,
          agg: aggByKey.get(key) ?? EMPTY_AGG,
          childCount: hierarchy.childRowKeysByParentRowKey.get(key)?.length ?? 0,
        } satisfies FindingsNode
      })
      .filter((node): node is FindingsNode => node != null)
  }, [aggByKey, currentKeys, hierarchy, rowByKey, searchText])

  const displayEntries = useMemo(() => {
    const byEvidence = (left: FindingsNode, right: FindingsNode) =>
      nodeBestEvidence(right, parentMode) - nodeBestEvidence(left, parentMode) ||
      nodeLargestEffect(right, parentMode) - nodeLargestEffect(left, parentMode) ||
      conceptLabel(left.row).localeCompare(conceptLabel(right.row))
    const byEffect = (left: FindingsNode, right: FindingsNode) =>
      nodeLargestEffect(right, parentMode) - nodeLargestEffect(left, parentMode) || byEvidence(left, right)
    const byBreadth = (left: FindingsNode, right: FindingsNode) =>
      nodeBreadth(right, parentMode, evidenceCutoff) - nodeBreadth(left, parentMode, evidenceCutoff) ||
      byEvidence(left, right)

    const ranked = [...currentNodes]
      .sort(rankMode === "effect" ? byEffect : rankMode === "breadth" ? byBreadth : byEvidence)
      .slice(0, maxRows)
    if (organizeMode === "ranked" || ranked.length < 2) {
      return ranked.map((node) => ({
        type: "node" as const,
        key: node.row.rowKey,
        node,
      }))
    }

    const vectors = buildProfileVectors(ranked, parentMode, evidenceCutoff)
    const groups = clusterProfiles(vectors, clusterCount)
      .map((indices) => ({
        indices,
        score: Math.max(...indices.map((index) => nodeBestEvidence(ranked[index], parentMode))),
        firstRank: Math.min(...indices),
      }))
      .sort((left, right) => right.score - left.score || left.firstRank - right.firstRank)

    const entries: DisplayEntry[] = []
    groups.forEach((group, groupIndex) => {
      entries.push({
        type: "group",
        key: `cluster-${groupIndex}`,
        label: `Cluster ${groupIndex + 1}: ${clusterProfileLabel(group.indices, vectors)}`,
        count: group.indices.length,
        rowKeys: group.indices.map((index) => ranked[index].row.rowKey),
      })
      entries.push(...group.indices
        .sort((left, right) => left - right)
        .map((index) => ({ type: "node" as const, key: ranked[index].row.rowKey, node: ranked[index] })))
    })
    return entries
  }, [clusterCount, currentNodes, evidenceCutoff, maxRows, organizeMode, parentMode, rankMode])

  function openNode(node: FindingsNode) {
    if (node.childCount > 0) {
      setPath((current) => [...current, node.row.rowKey])
      setSearchText("")
    } else {
      onSelectConcept(node.row.rowKey)
    }
  }

  function pathLabel(rowKey: string) {
    const row = rowByKey.get(rowKey)
    return row ? conceptLabel(row) : rowKey
  }

  return (
    <Stack spacing={1.5}>
      <Grid container spacing={1} sx={{ p: 1, alignItems: "center" }}>
        {sharedControls}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            label="Search this level"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }} sx={{ display: "flex", justifyContent: "flex-end" }}>
          <FindingsAbout />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-rank-label">Rank by</InputLabel>
            <Select
              labelId="findings-rank-label"
              value={rankMode}
              label="Rank by"
              onChange={(event) => setRankMode(event.target.value as FindingsRankMode)}
            >
              <MenuItem value="evidence">Strongest evidence anywhere</MenuItem>
              <MenuItem value="effect">Largest effect anywhere</MenuItem>
              <MenuItem value="breadth">Broadest evidence</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-organize-label">Organize concepts</InputLabel>
            <Select
              labelId="findings-organize-label"
              value={organizeMode}
              label="Organize concepts"
              onChange={(event) => setOrganizeMode(event.target.value as FindingsOrganizeMode)}
            >
              <MenuItem value="ranked">Ranked list</MenuItem>
              <MenuItem value="clustered">Similar cross-analysis profiles</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        {organizeMode === "clustered" && (
          <Grid size={{ xs: 6, sm: 3, md: 1.8 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="findings-clusters-label">Clusters</InputLabel>
              <Select
                labelId="findings-clusters-label"
                value={clusterCount}
                label="Clusters"
                onChange={(event) => setClusterCount(event.target.value as FindingsClusterCount)}
              >
                <MenuItem value="auto">Automatic</MenuItem>
                <MenuItem value={3}>3 clusters</MenuItem>
                <MenuItem value={5}>5 clusters</MenuItem>
                <MenuItem value={8}>8 clusters</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        )}
        <Grid size={{ xs: 6, sm: 3, md: 1.6 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-show-label">Show</InputLabel>
            <Select
              labelId="findings-show-label"
              value={maxRows}
              label="Show"
              onChange={(event) => setMaxRows(Number(event.target.value))}
            >
              {[10, 25, 50].map((count) => <MenuItem key={count} value={count}>Top {count}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-parent-label">Parent result</InputLabel>
            <Select
              labelId="findings-parent-label"
              value={parentMode}
              label="Parent result"
              onChange={(event) => setParentMode(event.target.value as ParentResultMode)}
            >
              <MenuItem value="own">Concept&apos;s own result</MenuItem>
              <MenuItem value="subtree">Strongest in subtree</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 6, sm: 3, md: 1.8 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-cutoff-label">Evidence cutoff</InputLabel>
            <Select
              labelId="findings-cutoff-label"
              value={evidenceCutoff}
              label="Evidence cutoff"
              onChange={(event) => setEvidenceCutoff(Number(event.target.value))}
            >
              <MenuItem value={1.3}>-log10(p) &gt;= 1.3</MenuItem>
              <MenuItem value={2}>-log10(p) &gt;= 2</MenuItem>
              <MenuItem value={5}>-log10(p) &gt;= 5</MenuItem>
              <MenuItem value={10}>-log10(p) &gt;= 10</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="findings-scale-label">Effect scale</InputLabel>
            <Select
              labelId="findings-scale-label"
              value={capMode}
              label="Effect scale"
              onChange={(event) => setCapMode(event.target.value as EffectCapMode)}
            >
              <MenuItem value="full">Full observed range</MenuItem>
              <MenuItem value="p95">Cap at 95th percentile</MenuItem>
              <MenuItem value="p98">Cap at 98th percentile</MenuItem>
              <MenuItem value="p99">Cap at 99th percentile</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      <Stack direction="row" sx={{ px: 1, alignItems: "center", justifyContent: "space-between" }}>
        <Breadcrumbs aria-label="findings hierarchy">
          <Link
            component="button"
            underline="hover"
            color={path.length === 0 ? "text.primary" : "inherit"}
            onClick={() => setPath([])}
          >
            All roots
          </Link>
          {path.map((rowKey, index) => {
            const final = index === path.length - 1
            return final ? (
              <Typography key={rowKey} color="text.primary">{pathLabel(rowKey)}</Typography>
            ) : (
              <Link
                component="button"
                underline="hover"
                key={rowKey}
                onClick={() => setPath((current) => current.slice(0, index + 1))}
              >
                {pathLabel(rowKey)}
              </Link>
            )
          })}
        </Breadcrumbs>
        <Typography variant="caption" color="text.secondary">
          Showing {Math.min(currentNodes.length, maxRows).toLocaleString()} of {currentNodes.length.toLocaleString()}
          {" at this hierarchy level"} | scale +/-{formatNumber(effectRange, 2)}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ mx: 1, mb: 1, overflow: "hidden" }}>
        {chartLoading ? (
          <Box sx={{ minHeight: 260, display: "grid", placeItems: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : currentNodes.length === 0 ? (
          <Box sx={{ minHeight: 220, display: "grid", placeItems: "center", color: "text.secondary" }}>
            No concepts at this hierarchy level match the current filters and search.
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: "calc(100vh - 285px)" }}>
            <Table stickyHeader size="small" sx={{ minWidth: 1380, tableLayout: "fixed" }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 290, fontWeight: 700 }}>Concept</TableCell>
                  {HEATMAP_BLOCKS.map((block) => (
                    <TableCell key={block} align="center" sx={{ width: 150, fontWeight: 700 }}>
                      {BLOCK_LABELS[block]}
                    </TableCell>
                  ))}
                  <TableCell sx={{ width: 175, fontWeight: 700 }}>Across analyses</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayEntries.map((entry) => {
                  if (entry.type === "group") {
                    return (
                      <TableRow key={entry.key}>
                        <TableCell colSpan={8} sx={{ bgcolor: "action.hover", py: 0.75 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <Insights fontSize="small" color="primary" />
                            <Link
                              component="button"
                              type="button"
                              underline="hover"
                              variant="subtitle2"
                              onClick={() => onOpenConceptSet({
                                label: entry.label,
                                rowKeys: entry.rowKeys,
                              })}
                              title="Open this cluster's concepts in the table"
                              sx={{ textAlign: "left", fontWeight: 600 }}
                            >
                              {entry.label}
                            </Link>
                            <Typography variant="caption" color="text.secondary">
                              {entry.count.toLocaleString()} concept{entry.count === 1 ? "" : "s"}
                            </Typography>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  const { node } = entry
                  const logp = selectedLogp(node.agg, parentMode)
                  const smd = selectedSmd(node.agg, parentMode)
                  const breadth = nodeBreadth(node, parentMode, evidenceCutoff)
                  let bestIndex = 0
                  for (let index = 1; index < logp.length; index++) {
                    if ((logp[index] ?? -1) > (logp[bestIndex] ?? -1)) bestIndex = index
                  }
                  const bestBlock = logp[bestIndex] == null ? null : HEATMAP_BLOCKS[bestIndex]

                  return (
                    <TableRow key={entry.key} hover>
                      <TableCell sx={{ py: 0.9 }}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => openNode(node)}
                          sx={{
                            display: "flex",
                            width: "100%",
                            alignItems: "center",
                            gap: 0.75,
                            p: 0,
                            border: 0,
                            background: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            color: "inherit",
                          }}
                        >
                          {node.childCount > 0
                            ? <ChevronRight fontSize="small" color="primary" />
                            : <Box sx={{ width: 20, flex: "0 0 20px" }} />}
                          <Box sx={{ minWidth: 0 }}>
                            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                                {conceptLabel(node.row)}
                              </Typography>
                              {node.row.countMode === "descendant" && (
                                <AccountTreeRounded sx={{ fontSize: 13, color: "text.secondary" }} />
                              )}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {node.row.domainId} | {node.row.countMode}
                              {node.childCount > 0 ? ` | ${node.childCount} direct children` : ""}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      {HEATMAP_BLOCKS.map((block, index) => {
                        const ownLabel = `${conceptLabel(node.row)} (${node.row.countMode})`
                        const effectSource = parentMode === "own"
                          ? (smd[index] == null ? null : ownLabel)
                          : node.agg.strongestSmdSource[index]
                        const evidenceSource = parentMode === "own"
                          ? (logp[index] == null ? null : ownLabel)
                          : node.agg.maxLogpSource[index]
                        return (
                          <TableCell key={block} align="center" sx={{ px: 0.5, py: 0.55 }}>
                            <MiniEffect
                              block={block}
                              effect={smd[index]}
                              logp={logp[index]}
                              range={effectRange}
                              effectSource={effectSource}
                              evidenceSource={evidenceSource}
                              onClick={() => onSelectConcept(node.row.rowKey)}
                            />
                          </TableCell>
                        )
                      })}
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {breadth} of {HEATMAP_BLOCKS.length} above cutoff
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {bestBlock
                            ? `Best: ${BLOCK_LABELS[bestBlock]} | logp ${formatNumber(logp[bestIndex], 1)}`
                            : "No available evidence"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  )
}
