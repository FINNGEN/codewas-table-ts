import type { MRT_ColumnFiltersState, MRT_PaginationState, MRT_SortingState } from "material-react-table"
import { DISPLAY_ANALYSIS_TYPES } from "./constants"
import { MAX_NEG_LOG10 } from "./utils/utils"

export function escapeSqlString(value: string) {
  return value.replace(/'/g, "''")
}

// -log10(p) that survives underflow. Two reasons this is not just `-log10(expr)`: DuckDB raises
// "cannot take logarithm of zero" rather than returning infinity, and a p exported as 0 is really
// "smaller than a double can hold", so it gets the clamped ceiling (see MAX_NEG_LOG10). Sorting and
// column filters run on this expression, so it has to agree with the client-side negLog10().
function negLog10Sql(expr: string) {
  return `CASE
    WHEN ${expr} > 0 THEN -log10(${expr})
    WHEN ${expr} = 0 THEN ${MAX_NEG_LOG10}
    ELSE NULL
  END`
}

export type NumericComparison = { operator: string; value: number }
// OR of AND-groups: [[a, b], [c]] means (a AND b) OR c.
export type NumericFilterExpression = NumericComparison[][]

const FILTER_NUMBER = /^-?\d+(?:\.\d+)?$/
export function isFilterNumber(text: string) {
  return FILTER_NUMBER.test(text.trim())
}

function parseNumericComparison(text: string): NumericComparison | null {
  const match = text.trim().match(/^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  return { operator: match[1] ?? "=", value: Number(match[2]) }
}

// Accepts single comparisons ("> 5") and compounds joined by AND / OR (case-insensitive, or && / ||),
// e.g. ">= 5 AND < 10", "< 2 or > 8". AND binds tighter than OR; no parentheses. Returns null if any
// part fails to parse, so a typo never silently degrades into a looser filter.
export function parseNumericFilter(filterValue: string): NumericFilterExpression | null {
  const trimmed = filterValue.trim()
  if (!trimmed) return null
  const groups: NumericFilterExpression = []
  for (const orPart of trimmed.split(/\s*(?:\|\||\bor\b)\s*/i)) {
    const group: NumericComparison[] = []
    for (const andPart of orPart.split(/\s*(?:&&|\band\b)\s*/i)) {
      const comparison = parseNumericComparison(andPart)
      if (!comparison) return null
      group.push(comparison)
    }
    groups.push(group)
  }
  return groups
}

export function matchesNumericFilter(value: number, expression: NumericFilterExpression) {
  const compare = ({ operator, value: target }: NumericComparison) => {
    switch (operator) {
      case ">":
        return value > target
      case ">=":
        return value >= target
      case "<":
        return value < target
      case "<=":
        return value <= target
      default:
        return value === target
    }
  }
  return expression.some((group) => group.every(compare))
}

export function buildFilterConditions(columnFilters: MRT_ColumnFiltersState) {
  const conditions: string[] = []
  const textLike = (sqlExpr: string, value: string) => {
    const safe = escapeSqlString(value.trim().toLowerCase())
    return `lower(coalesce(${sqlExpr}, '')) LIKE '%${safe}%'`
  }
  const numericExpr = (sqlExpr: string, value: string) => {
    const parsed = parseNumericFilter(value)
    if (!parsed) return null
    const groups = parsed.map(
      (group) => `(${group.map((c) => `${sqlExpr} ${c.operator} ${c.value}`).join(" AND ")})`,
    )
    return `(${groups.join(" OR ")})`
  }
  const numericMap: Record<string, string> = {
    binaryCasesControl: "binaryCaseYes",
    binaryLogP: "binaryLogP",
    binaryEffect: "binaryEffectSize",
    countsMean: "countsCaseMean",
    countsLogP: "countsLogP",
    countsEffect: "countsEffectSize",
    ageMean: "ageCaseMean",
    ageLogP: "ageLogP",
    ageEffect: "ageEffectSize",
    daysMean: "daysCaseMean",
    daysLogP: "daysLogP",
    daysEffect: "daysEffectSize",
    continuousMean: "continuousCaseMean",
    continuousLogP: "continuousLogP",
    continuousEffect: "continuousEffectSize",
    categoricalCasesControl: "categoricalCaseYes",
    categoricalLogP: "categoricalLogP",
    categoricalEffect: "categoricalEffectSize",
  }

  for (const filter of columnFilters) {
    const raw = String(filter.value ?? "").trim()
    if (!raw) continue
    if (filter.id === "conceptInfo") {
      const safe = escapeSqlString(raw.toLowerCase())
      conditions.push(
        `(
          lower(coalesce(conceptName, '')) LIKE '%${safe}%'
          OR lower(coalesce(conceptCode, '')) LIKE '%${safe}%'
          OR CAST(conceptId AS VARCHAR) LIKE '%${safe}%'
          OR lower(coalesce(domainId, '')) LIKE '%${safe}%'
          OR lower(coalesce(countMode, '')) LIKE '%${safe}%'
        )`,
      )
      continue
    }
    if (filter.id === "ancestorConceptIds") {
      conditions.push(textLike("ancestorConceptIds", raw))
      continue
    }
    const mapped = numericMap[filter.id]
    if (mapped) {
      const condition = numericExpr(mapped, raw)
      if (condition) conditions.push(condition)
    }
  }
  return conditions
}

export function buildSortExpression(sorting: MRT_SortingState) {
  const sortMap: Record<string, string> = {
    conceptInfo: "conceptName",
    ancestorConceptIds: "ancestorConceptIds",
    binaryCasesControl: "binaryCaseYes",
    binaryLogP: "binaryLogP",
    binaryEffect: "binaryEffectSize",
    countsMean: "countsCaseMean",
    countsLogP: "countsLogP",
    countsEffect: "countsEffectSize",
    ageMean: "ageCaseMean",
    ageLogP: "ageLogP",
    ageEffect: "ageEffectSize",
    daysMean: "daysCaseMean",
    daysLogP: "daysLogP",
    daysEffect: "daysEffectSize",
    continuousMean: "continuousCaseMean",
    continuousLogP: "continuousLogP",
    continuousEffect: "continuousEffectSize",
    categoricalCasesControl: "categoricalCaseYes",
    categoricalLogP: "categoricalLogP",
    categoricalEffect: "categoricalEffectSize",
  }
  if (sorting.length === 0) return "ORDER BY binaryEffectSize DESC NULLS LAST, conceptName ASC"
  const clauses = sorting
    .map((sort) => {
      const expr = sortMap[sort.id]
      if (!expr) return null
      return `${expr} ${sort.desc ? "DESC" : "ASC"} NULLS LAST`
    })
    .filter((value): value is string => Boolean(value))
  return clauses.length > 0 ? `ORDER BY ${clauses.join(", ")}` : "ORDER BY conceptName ASC"
}

function buildContinuousBlockQueryFromBase(
  analysisType: string,
  prefix: "counts" | "age" | "days" | "continuous",
) {
  return `
    SELECT
      b.conceptId,
      b.domainId,
      b.countMode,
      MAX(case_cov.countValue) AS ${prefix}CaseCount,
      MAX(control_cov.countValue) AS ${prefix}ControlCount,
      MAX(case_cov.averageValue) AS ${prefix}CaseMean,
      MAX(control_cov.averageValue) AS ${prefix}ControlMean,
      MAX(case_cov.standardDeviation) AS ${prefix}CaseSd,
      MAX(control_cov.standardDeviation) AS ${prefix}ControlSd,
      MAX(case_cov.p10Value) AS ${prefix}P10Case,
      MAX(case_cov.p25Value) AS ${prefix}P25Case,
      MAX(case_cov.medianValue) AS ${prefix}MedianCase,
      MAX(case_cov.p75Value) AS ${prefix}P75Case,
      MAX(case_cov.p90Value) AS ${prefix}P90Case,
      MAX(control_cov.p10Value) AS ${prefix}P10Control,
      MAX(control_cov.p25Value) AS ${prefix}P25Control,
      MAX(control_cov.medianValue) AS ${prefix}MedianControl,
      MAX(control_cov.p75Value) AS ${prefix}P75Control,
      MAX(control_cov.p90Value) AS ${prefix}P90Control,
      MIN(st.pValue) AS ${prefix}PValue,
      ${negLog10Sql("MIN(st.pValue)")} AS ${prefix}LogP,
      MAX(st.effectSize) AS ${prefix}EffectSize,
      MAX(st.standarizeMeanDifference) AS ${prefix}Smd,
      MAX(st.testName) AS ${prefix}TestName,
      MAX(case_cov.unit) AS ${prefix}Unit
    FROM base AS b
    JOIN statisticalTests AS st ON st.conceptId = b.conceptId AND st.countMode = b.countMode
    JOIN analysisRef AS ar ON ar.analysisId = st.analysisId AND ar.domainId = b.domainId AND ar.analysisType = '${analysisType}'
    JOIN comparisons AS cmp ON cmp.comparisonId = st.comparisonId
    LEFT JOIN covariatesContinuous AS case_cov
      ON case_cov.cohortDefinitionId = cmp.caseCohortId
     AND case_cov.analysisId = st.analysisId
     AND case_cov.conceptId = st.conceptId
     AND case_cov.countMode = st.countMode
    LEFT JOIN covariatesContinuous AS control_cov
      ON control_cov.cohortDefinitionId = cmp.controlCohortId
     AND control_cov.analysisId = st.analysisId
     AND control_cov.conceptId = st.conceptId
     AND control_cov.countMode = st.countMode
     AND coalesce(control_cov.unit, '') = coalesce(case_cov.unit, '')
    GROUP BY b.conceptId, b.domainId, b.countMode
  `
}

function buildSummaryQueryCtes(countMode: string, domainId: string, searchText: string) {
  const safeCountMode = countMode === "all" ? null : escapeSqlString(countMode)
  const safeDomain = domainId === "all" ? null : escapeSqlString(domainId)
  const safeSearch = searchText.trim() ? escapeSqlString(searchText.trim().toLowerCase()) : null

  return `
    WITH base AS (
      SELECT
        st.conceptId,
        cr.conceptName,
        cr.conceptCode,
        cr.ancestorConceptIds,
        ar.domainId,
        st.countMode,
        MIN(st.pValue) AS bestPValue
      FROM statisticalTests AS st
      JOIN analysisRef AS ar ON ar.analysisId = st.analysisId
      LEFT JOIN conceptRef AS cr ON cr.conceptId = st.conceptId
      WHERE ar.analysisType IN (${DISPLAY_ANALYSIS_TYPES.map((type) => `'${type}'`).join(", ")})
        ${safeCountMode ? `AND st.countMode = '${safeCountMode}'` : ""}
        ${safeDomain ? `AND ar.domainId = '${safeDomain}'` : ""}
        ${
          safeSearch
            ? `AND (
                lower(coalesce(cr.conceptName, '')) LIKE '%${safeSearch}%'
                OR lower(coalesce(cr.conceptCode, '')) LIKE '%${safeSearch}%'
                OR CAST(st.conceptId AS VARCHAR) LIKE '%${safeSearch}%'
              )`
            : ""
        }
      GROUP BY st.conceptId, cr.conceptName, cr.conceptCode, cr.ancestorConceptIds, ar.domainId, st.countMode
    ),
    binary_stats AS (
      SELECT
        b.conceptId,
        b.domainId,
        b.countMode,
        -- CodeWAS represents a zero count by omitting that cohort/concept row.
        -- Mirror the statistical-test construction here so the viewer displays zero rather than N/A.
        COALESCE(MAX(case_cov.sumValue), 0) AS binaryCaseYes,
        COALESCE(MAX(control_cov.sumValue), 0) AS binaryControlYes,
        MAX(case_totals.cohortSubjects) AS binaryTotalCases,
        MAX(control_totals.cohortSubjects) AS binaryTotalControls,
        MIN(st.pValue) AS binaryPValue,
        MAX(st.effectSize) AS binaryEffectSize,
        MAX(st.standarizeMeanDifference) AS binarySmd,
        MAX(st.testName) AS binaryTestName
      FROM base AS b
      JOIN statisticalTests AS st ON st.conceptId = b.conceptId AND st.countMode = b.countMode
      JOIN analysisRef AS ar ON ar.analysisId = st.analysisId AND ar.domainId = b.domainId AND ar.analysisType = 'Binary'
      JOIN comparisons AS cmp ON cmp.comparisonId = st.comparisonId
      LEFT JOIN covariates AS case_cov
        ON case_cov.cohortDefinitionId = cmp.caseCohortId
       AND case_cov.analysisId = st.analysisId
       AND case_cov.conceptId = st.conceptId
       AND case_cov.countMode = st.countMode
      LEFT JOIN covariates AS control_cov
        ON control_cov.cohortDefinitionId = cmp.controlCohortId
       AND control_cov.analysisId = st.analysisId
       AND control_cov.conceptId = st.conceptId
       AND control_cov.countMode = st.countMode
      LEFT JOIN cohortCounts AS case_totals ON case_totals.cohortId = cmp.caseCohortId
      LEFT JOIN cohortCounts AS control_totals ON control_totals.cohortId = cmp.controlCohortId
      GROUP BY b.conceptId, b.domainId, b.countMode
    ),
    categorical_stats AS (
      SELECT
        b.conceptId,
        b.domainId,
        b.countMode,
        SUM(coalesce(case_cov.sumValue, 0)) AS categoricalCaseYes,
        SUM(coalesce(control_cov.sumValue, 0)) AS categoricalControlYes,
        MIN(st.pValue) AS categoricalPValue,
        MAX(st.effectSize) AS categoricalEffectSize,
        MAX(st.standarizeMeanDifference) AS categoricalSmd,
        MAX(st.testName) AS categoricalTestName,
        string_agg(
          coalesce(cat_ref.conceptName, 'Unknown') || '::' ||
          CAST(coalesce(case_cov.sumValue, 0) AS VARCHAR) || '::' ||
          CAST(coalesce(control_cov.sumValue, 0) AS VARCHAR),
          '|'
          ORDER BY coalesce(cat_ref.conceptName, 'Unknown')
        ) AS categoricalDistribution
      FROM base AS b
      JOIN statisticalTests AS st ON st.conceptId = b.conceptId AND st.countMode = b.countMode
      JOIN analysisRef AS ar ON ar.analysisId = st.analysisId AND ar.domainId = b.domainId AND ar.analysisType = 'Categorical'
      JOIN comparisons AS cmp ON cmp.comparisonId = st.comparisonId
      LEFT JOIN covariates AS case_cov
        ON case_cov.cohortDefinitionId = cmp.caseCohortId
       AND case_cov.analysisId = st.analysisId
       AND case_cov.conceptId = st.conceptId
       AND case_cov.countMode = st.countMode
      LEFT JOIN covariates AS control_cov
        ON control_cov.cohortDefinitionId = cmp.controlCohortId
       AND control_cov.analysisId = st.analysisId
       AND control_cov.conceptId = st.conceptId
       AND control_cov.countMode = st.countMode
       AND control_cov.categoryId = case_cov.categoryId
      LEFT JOIN conceptRef AS cat_ref ON cat_ref.conceptId = case_cov.categoryId
      GROUP BY b.conceptId, b.domainId, b.countMode
    ),
    counts_stats AS (
      SELECT * FROM (${buildContinuousBlockQueryFromBase("Counts", "counts")})
    ),
    age_stats AS (
      SELECT * FROM (${buildContinuousBlockQueryFromBase("AgeFirstEvent", "age")})
    ),
    days_stats AS (
      SELECT * FROM (${buildContinuousBlockQueryFromBase("DaysToFirstEvent", "days")})
    ),
    continuous_stats AS (
      SELECT * FROM (${buildContinuousBlockQueryFromBase("Continuous", "continuous")})
    ),
    final_rows AS (
      SELECT
        CAST(b.conceptId AS VARCHAR) || '|' || b.domainId || '|' || b.countMode AS rowKey,
        b.conceptId,
        b.conceptName,
        b.conceptCode,
        b.ancestorConceptIds,
        b.domainId,
        b.countMode,
        b.bestPValue,
        bs.binaryCaseYes,
        bs.binaryControlYes,
        bs.binaryTotalCases,
        bs.binaryTotalControls,
        bs.binaryPValue,
        ${negLog10Sql("bs.binaryPValue")} AS binaryLogP,
        bs.binaryEffectSize,
        bs.binarySmd,
        bs.binaryTestName,
        cs.categoricalCaseYes,
        cs.categoricalControlYes,
        cs.categoricalPValue,
        ${negLog10Sql("cs.categoricalPValue")} AS categoricalLogP,
        cs.categoricalEffectSize,
        cs.categoricalSmd,
        cs.categoricalTestName,
        cs.categoricalDistribution,
        cts.* EXCLUDE (conceptId, domainId, countMode),
        ags.* EXCLUDE (conceptId, domainId, countMode),
        dys.* EXCLUDE (conceptId, domainId, countMode),
        cos.* EXCLUDE (conceptId, domainId, countMode)
      FROM base AS b
      LEFT JOIN binary_stats AS bs ON bs.conceptId = b.conceptId AND bs.domainId = b.domainId AND bs.countMode = b.countMode
      LEFT JOIN categorical_stats AS cs ON cs.conceptId = b.conceptId AND cs.domainId = b.domainId AND cs.countMode = b.countMode
      LEFT JOIN counts_stats AS cts ON cts.conceptId = b.conceptId AND cts.domainId = b.domainId AND cts.countMode = b.countMode
      LEFT JOIN age_stats AS ags ON ags.conceptId = b.conceptId AND ags.domainId = b.domainId AND ags.countMode = b.countMode
      LEFT JOIN days_stats AS dys ON dys.conceptId = b.conceptId AND dys.domainId = b.domainId AND dys.countMode = b.countMode
      LEFT JOIN continuous_stats AS cos ON cos.conceptId = b.conceptId AND cos.domainId = b.domainId AND cos.countMode = b.countMode
    )
  `
}

export function buildPagedSummaryQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  columnFilters: MRT_ColumnFiltersState,
  sorting: MRT_SortingState,
  pagination: MRT_PaginationState,
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const conditions = buildFilterConditions(columnFilters)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const orderBy = buildSortExpression(sorting)
  const offset = pagination.pageIndex * pagination.pageSize
  return `
    ${ctes}
    SELECT * FROM final_rows
    ${whereClause}
    ${orderBy}
    LIMIT ${pagination.pageSize}
    OFFSET ${offset}
  `
}

export function buildSummaryCountQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  columnFilters: MRT_ColumnFiltersState,
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const conditions = buildFilterConditions(columnFilters)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return `
    ${ctes}
    SELECT COUNT(*) AS rowCount
    FROM final_rows
    ${whereClause}
  `
}

export function buildFullSummaryQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  columnFilters: MRT_ColumnFiltersState,
  limit?: number | null,
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const conditions = buildFilterConditions(columnFilters)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return `
    ${ctes}
    SELECT * FROM final_rows
    ${whereClause}
    ORDER BY bestPValue ASC NULLS LAST, conceptName ASC
    ${limit != null ? `LIMIT ${limit}` : ""}
  `
}

// Lean projection for the heatmap/scatter views: only the identity columns plus the
// per-block p-value, effect size and SMD each cell needs. ~15 columns instead of ConceptSummaryRow's
// ~80, so tens of thousands of rows stay cheap to transfer, map, and hold in memory. Field names
// match ConceptSummaryRow so getChartMetricValue and the scatter chart work unchanged.
export function buildHeatmapQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  columnFilters: MRT_ColumnFiltersState,
  limit?: number | null,
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const conditions = buildFilterConditions(columnFilters)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return `
    ${ctes}
    SELECT
      rowKey,
      conceptId,
      conceptName,
      conceptCode,
      ancestorConceptIds,
      domainId,
      countMode,
      bestPValue,
      binaryPValue,
      binaryEffectSize,
      binarySmd,
      countsPValue,
      countsEffectSize,
      countsSmd,
      agePValue,
      ageEffectSize,
      ageSmd,
      daysPValue,
      daysEffectSize,
      daysSmd,
      continuousPValue,
      continuousEffectSize,
      continuousSmd,
      categoricalPValue,
      categoricalEffectSize,
      categoricalSmd
    FROM final_rows
    ${whereClause}
    ORDER BY bestPValue ASC NULLS LAST, conceptName ASC
    ${limit != null ? `LIMIT ${limit}` : ""}
  `
}

export function buildHierarchyMetaQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  columnFilters: MRT_ColumnFiltersState,
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const conditions = buildFilterConditions(columnFilters)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return `
    ${ctes}
    SELECT
      rowKey,
      conceptId,
      conceptName,
      conceptCode,
      ancestorConceptIds,
      domainId,
      countMode,
      bestPValue
    FROM final_rows
    ${whereClause}
    ORDER BY bestPValue ASC NULLS LAST, conceptName ASC
  `
}

export function buildSummaryRowsByRowKeysQuery(
  countMode: string,
  domainId: string,
  searchText: string,
  rowKeys: string[],
) {
  const ctes = buildSummaryQueryCtes(countMode, domainId, searchText)
  const safeRowKeys = rowKeys.map((rowKey) => `'${escapeSqlString(rowKey)}'`).join(", ")
  return `
    ${ctes}
    SELECT *
    FROM final_rows
    WHERE rowKey IN (${safeRowKeys})
  `
}
