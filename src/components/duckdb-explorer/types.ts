import type { MRT_ColumnFiltersState } from "material-react-table"

export type AnalysisBlock =
  | "Binary"
  | "Categorical"
  | "Counts"
  | "AgeFirstEvent"
  | "DaysToFirstEvent"
  | "Continuous"

export type ConceptSummaryRow = {
  rowKey: string
  conceptId: number
  conceptName: string | null
  conceptCode: string | null
  ancestorConceptIds: string | null
  domainId: string
  countMode: string
  bestPValue: number | null
  binaryCaseYes?: number | null
  binaryControlYes?: number | null
  binaryTotalCases?: number | null
  binaryTotalControls?: number | null
  binaryPValue?: number | null
  binaryEffectSize?: number | null
  binarySmd?: number | null
  binaryTestName?: string | null
  categoricalCaseYes?: number | null
  categoricalControlYes?: number | null
  categoricalPValue?: number | null
  categoricalEffectSize?: number | null
  categoricalSmd?: number | null
  categoricalTestName?: string | null
  categoricalDistribution?: string | null
  countsCaseCount?: number | null
  countsControlCount?: number | null
  countsCaseMean?: number | null
  countsControlMean?: number | null
  countsCaseSd?: number | null
  countsControlSd?: number | null
  countsP10Case?: number | null
  countsP25Case?: number | null
  countsMedianCase?: number | null
  countsP75Case?: number | null
  countsP90Case?: number | null
  countsP10Control?: number | null
  countsP25Control?: number | null
  countsMedianControl?: number | null
  countsP75Control?: number | null
  countsP90Control?: number | null
  countsPValue?: number | null
  countsEffectSize?: number | null
  countsSmd?: number | null
  countsTestName?: string | null
  ageCaseCount?: number | null
  ageControlCount?: number | null
  ageCaseMean?: number | null
  ageControlMean?: number | null
  ageCaseSd?: number | null
  ageControlSd?: number | null
  ageP10Case?: number | null
  ageP25Case?: number | null
  ageMedianCase?: number | null
  ageP75Case?: number | null
  ageP90Case?: number | null
  ageP10Control?: number | null
  ageP25Control?: number | null
  ageMedianControl?: number | null
  ageP75Control?: number | null
  ageP90Control?: number | null
  agePValue?: number | null
  ageEffectSize?: number | null
  ageSmd?: number | null
  ageTestName?: string | null
  daysCaseCount?: number | null
  daysControlCount?: number | null
  daysCaseMean?: number | null
  daysControlMean?: number | null
  daysCaseSd?: number | null
  daysControlSd?: number | null
  daysP10Case?: number | null
  daysP25Case?: number | null
  daysMedianCase?: number | null
  daysP75Case?: number | null
  daysP90Case?: number | null
  daysP10Control?: number | null
  daysP25Control?: number | null
  daysMedianControl?: number | null
  daysP75Control?: number | null
  daysP90Control?: number | null
  daysPValue?: number | null
  daysEffectSize?: number | null
  daysSmd?: number | null
  daysTestName?: string | null
  continuousCaseCount?: number | null
  continuousControlCount?: number | null
  continuousCaseMean?: number | null
  continuousControlMean?: number | null
  continuousCaseSd?: number | null
  continuousControlSd?: number | null
  continuousP10Case?: number | null
  continuousP25Case?: number | null
  continuousMedianCase?: number | null
  continuousP75Case?: number | null
  continuousP90Case?: number | null
  continuousP10Control?: number | null
  continuousP25Control?: number | null
  continuousMedianControl?: number | null
  continuousP75Control?: number | null
  continuousP90Control?: number | null
  continuousPValue?: number | null
  continuousEffectSize?: number | null
  continuousSmd?: number | null
  continuousTestName?: string | null
  continuousUnit?: string | null
  // Verdict from the optional AI review pass (`aiPrioritization`). Undefined when the loaded
  // database has no AI tables, null when the pass never scored this concept (aiSent = false).
  aiCategory?: string | null
  aiRationale?: string | null
  subRows?: ConceptSummaryRow[]
}

// The AI category selection, as the query builders need it. `enabled` is separate from `category`
// because it gates the SQL itself: without `aiPrioritization` in the database the join cannot be
// emitted at all, whatever the user picked.
export type AiFilter = {
  enabled: boolean
  category: string
}

// One row of the `cohortsInfo` table. Unlike `analysisRef`, this table is keyed by cohort (not by
// analysis) and carries no domainId/analysisType — it describes the case/control cohorts themselves.
// The `sql` and `json` columns (full cohort definitions) are deliberately not selected: they are
// large and unused by the explorer.
export type CohortInfoRow = {
  cohortId: number
  cohortName: string | null
  shortName: string | null
  subsetParent: number | null
  isSubset: boolean
  subsetDefinitionId: number | null
  cohortEntries: number | null
  cohortSubjects: number | null
  // "use" in SQL — "cases" or "controls" in the shipped exports.
  cohortUse: string | null
}

// cohortsInfo keyed by cohortId, so statisticalTests.caseCohortId / .controlCohortId resolve in O(1).
export type CohortInfoIndex = Record<number, CohortInfoRow>

export type BlockMetricRow = Record<string, unknown>
export type ChartBlockKey = "Binary" | "Count" | "Age" | "Days" | "Continuous" | "Categorical"
export type ChartMetricKey = "-log10" | "effectSize"
export type ChartMode = "heatmap" | "scatter"
export type ChartScope = "filtered" | "all"
export type TableMode = "flat" | "hierarchy"
export type HeatmapOrderMode = "strongest" | "selectedBlock" | "repeatEvidence" | "clustered"
export type HeatmapScaleMode = "global" | "perColumn"
// What drives the overview's cell color: -log10(p) (the original encoding), SD-standardized effect clamped to
// ±OVERVIEW_SMD_CAP, or SD-standardized effect z-scored within each analysis row.
export type OverviewColorMetric = "pValue" | "smdCapped" | "smdRowScaled"

export type HeatmapCell = {
  row: ConceptSummaryRow
  block: ChartBlockKey | "Concept"
  value: number | null
}

export type HierarchyMetaRow = Pick<
  ConceptSummaryRow,
  | "rowKey"
  | "conceptId"
  | "conceptName"
  | "conceptCode"
  | "ancestorConceptIds"
  | "domainId"
  | "countMode"
>

export type HierarchyIndex = {
  rootRowKeys: string[]
  childRowKeysByParentRowKey: Map<string, string[]>
}

export type { MRT_ColumnFiltersState }
