import { interpolateLab } from "d3"
import { COLUMNS } from "../../../utils/constants"
import {
  CHART_BLOCK_FIELD_PREFIX,
  HEATMAP_BLOCKS,
  OVERVIEW_DIVERGING_MID,
  OVERVIEW_DIVERGING_NEGATIVE,
  OVERVIEW_DIVERGING_POSITIVE,
  OVERVIEW_RAMP_FROM,
  OVERVIEW_RAMP_TO,
} from "../constants"
import type { ChartBlockKey, ChartMetricKey, ConceptSummaryRow } from "../types"
import { negLog10 } from "./utils"

// Perceptual white→main-color ramp (d3 Lab interpolation). `t` is clamped to [0, 1]. Cells are encoded
// with texture rather than color (see utils/heatmapPatterns); this ramp backs the color fallback and
// the level swatches derived from it.
const rampInterpolator = interpolateLab(OVERVIEW_RAMP_FROM, OVERVIEW_RAMP_TO)
export function rampColor(t: number) {
  return rampInterpolator(Math.max(0, Math.min(1, t)))
}

// Diverging ramp for signed values (SD-effect modes). `t` in [-1, 1]: -1 → negative hue, 0 → neutral,
// 1 → positive hue; clamped outside that range.
const divergingNegative = interpolateLab(OVERVIEW_DIVERGING_MID, OVERVIEW_DIVERGING_NEGATIVE)
const divergingPositive = interpolateLab(OVERVIEW_DIVERGING_MID, OVERVIEW_DIVERGING_POSITIVE)
export function divergingColor(t: number) {
  const clamped = Math.max(-1, Math.min(1, t))
  return clamped < 0 ? divergingNegative(-clamped) : divergingPositive(clamped)
}

export function getSmdValue(row: ConceptSummaryRow, block: ChartBlockKey) {
  const value = row[`${CHART_BLOCK_FIELD_PREFIX[block]}Smd` as keyof ConceptSummaryRow] as
    | number
    | null
    | undefined
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function getChartMetricValue(
  row: ConceptSummaryRow,
  block: ChartBlockKey,
  metric: ChartMetricKey,
) {
  const prefix = CHART_BLOCK_FIELD_PREFIX[block]
  if (metric === "effectSize") {
    return row[`${prefix}EffectSize` as keyof ConceptSummaryRow] as number | null
  }
  return negLog10(row[`${prefix}PValue` as keyof ConceptSummaryRow] as number | null)
}

export function getBestHeatmapScore(row: ConceptSummaryRow) {
  return Math.max(
    ...HEATMAP_BLOCKS.map((block) => {
      const value = getChartMetricValue(row, block, "-log10")
      return value ?? 0
    }),
  )
}

export function getRepeatEvidenceCount(row: ConceptSummaryRow, threshold: number) {
  return HEATMAP_BLOCKS.reduce((count, block) => {
    const value = getChartMetricValue(row, block, "-log10")
    return count + ((value ?? 0) >= threshold ? 1 : 0)
  }, 0)
}

// Both heatmap scales (continuous per-column and bucketed global) now resolve a value to a texture
// level rather than a color: see heatmapPatternLevel / bucketPatternLevel in utils/heatmapPatterns.

// Per-row metrics derived once from the heatmap rows so sorting, clustering, and drawing don't
// recompute them. `logp` is the per-block -log10(p) (indexed by HEATMAP_BLOCKS, null when absent),
// `bestScore` the strongest block, `vector` the per-column-normalized profile used for clustering,
// `smd` the per-block SD-standardized effect (same indexing as `logp`).
export type HeatmapDerived = {
  logp: (number | null)[]
  smd: (number | null)[]
  bestScore: number
  vector: number[]
}

// Mean and sample SD of one analysis block's SD-standardized effect across all rows — the parameters of the overview's
// row scaling, z = (SD effect - mean) / sd. `sd` is 0 when fewer than two values exist or all are equal.
export type SmdRowStats = { mean: number; sd: number }

// Single pass over all rows computing per-row derived metrics plus the per-column and global
// maxima — using plain loops (never `Math.max(...arr)`, which overflows the call stack at tens of
// thousands of args). Maxima seed at 1 so an empty/all-null input never yields -Infinity or 0.
export function computeHeatmapDerived(rows: ConceptSummaryRow[]): {
  perColumnMax: Record<ChartBlockKey, number>
  globalMax: number
  derivedByKey: Map<string, HeatmapDerived>
  smdRowStats: SmdRowStats[]
} {
  const blockCount = HEATMAP_BLOCKS.length
  const perColumnMaxArr = new Array<number>(blockCount).fill(1)
  let globalMax = 1
  const derivedByKey = new Map<string, HeatmapDerived>()
  const smdCount = new Array<number>(blockCount).fill(0)
  const smdSum = new Array<number>(blockCount).fill(0)
  const smdSumSq = new Array<number>(blockCount).fill(0)

  for (const row of rows) {
    const logp = new Array<number | null>(blockCount)
    const smd = new Array<number | null>(blockCount)
    let bestScore = 0
    for (let b = 0; b < blockCount; b++) {
      const smdValue = getSmdValue(row, HEATMAP_BLOCKS[b])
      smd[b] = smdValue
      if (smdValue != null) {
        smdCount[b]++
        smdSum[b] += smdValue
        smdSumSq[b] += smdValue * smdValue
      }
      const value = getChartMetricValue(row, HEATMAP_BLOCKS[b], "-log10")
      logp[b] = value
      if (value != null) {
        if (value > perColumnMaxArr[b]) perColumnMaxArr[b] = value
        if (value > globalMax) globalMax = value
        if (value > bestScore) bestScore = value
      }
    }
    derivedByKey.set(row.rowKey, {
      logp,
      smd,
      bestScore,
      vector: new Array<number>(blockCount).fill(0),
    })
  }

  // Second pass: normalize each block by its column max (now finalized) into the cluster vector.
  for (const derived of derivedByKey.values()) {
    for (let b = 0; b < blockCount; b++) {
      derived.vector[b] = (derived.logp[b] ?? 0) / perColumnMaxArr[b]
    }
  }

  const perColumnMax = Object.fromEntries(
    HEATMAP_BLOCKS.map((block, b) => [block, perColumnMaxArr[b]]),
  ) as Record<ChartBlockKey, number>

  const smdRowStats = HEATMAP_BLOCKS.map((_, b) => {
    const n = smdCount[b]
    const mean = n > 0 ? smdSum[b] / n : 0
    const variance = n > 1 ? Math.max(0, (smdSumSq[b] - n * mean * mean) / (n - 1)) : 0
    return { mean, sd: Math.sqrt(variance) }
  })

  return { perColumnMax, globalMax, derivedByKey, smdRowStats }
}

export function getRepeatEvidenceCountFromLogp(logp: (number | null)[], threshold: number) {
  let count = 0
  for (const value of logp) {
    if ((value ?? 0) >= threshold) count++
  }
  return count
}

function vectorDistance(left: number[], right: number[]) {
  let sum = 0
  for (let i = 0; i < left.length; i++) {
    const diff = left[i] - right[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// Greedy nearest-neighbor ordering, but bounded: only the top `maxClusterRows` by evidence are
// clustered (the O(n²) part); the remainder is appended in descending strength. Reuses precomputed
// vectors so each distance is a cheap array read, not a metric recompute.
export function clusterHeatmapRows(
  rows: ConceptSummaryRow[],
  derivedByKey: Map<string, HeatmapDerived>,
  maxClusterRows: number,
): ConceptSummaryRow[] {
  if (rows.length <= 2) return rows

  const bestScore = (row: ConceptSummaryRow) => derivedByKey.get(row.rowKey)?.bestScore ?? 0
  const vector = (row: ConceptSummaryRow) => derivedByKey.get(row.rowKey)?.vector ?? []

  const sorted = [...rows].sort((left, right) => bestScore(right) - bestScore(left))
  const clusterCount = Math.min(sorted.length, Math.max(2, maxClusterRows))
  const remaining = sorted.slice(0, clusterCount)
  const tail = sorted.slice(clusterCount) // already in descending bestScore order

  const ordered: ConceptSummaryRow[] = [remaining.shift() as ConceptSummaryRow]
  while (remaining.length > 0) {
    const lastVector = vector(ordered[ordered.length - 1])
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < remaining.length; i++) {
      const candidateDistance = vectorDistance(lastVector, vector(remaining[i]))
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        bestIndex = i
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0])
  }

  return ordered.concat(tail)
}

export function getHeatmapHeaderLines(block: ChartBlockKey) {
  const label = COLUMNS.find((column) => column.key === block)?.label ?? block
  switch (label) {
    case "Age at First Event":
      return ["Age at", "First Event"]
    case "Days to First Event":
      return ["Days to", "First Event"]
    default:
      return [label]
  }
}

export function matchesHeatmapSearch(row: ConceptSummaryRow, searchText: string) {
  const needle = searchText.trim().toLowerCase()
  if (!needle) return true
  return [
    row.conceptName ?? "",
    row.conceptCode ?? "",
    String(row.conceptId),
    row.domainId,
    row.countMode,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle)
}
