import type { MRT_ColumnDef, MRT_FilterFn } from "material-react-table"
import {
  type ConceptRow,
  type ConceptMetadata,
  type SummaryStats,
  type DistributionRow,
  type Test,
  type BinaryCount,
} from "../utils/types"
import { Box, Chip, Tooltip, Typography } from "@mui/material"
import { CategoricalDistributionBar, CategoryBar, MeanComparisonChart } from "../components/Visuals"
import { groupCellProps, valueChip } from "./tableUtils"
import { COLUMNS_COLORS } from "../utils/constants"
import { CasesControlCell } from "./custom-cells/CasesControlsCell"
import { Info } from "@mui/icons-material"
import { SlopeHeader } from "./custom-cells/SlopeHeader"
import { useMemo } from "react"

// ─── Factory config ───────────────────────────────────────────────────────────

type StatGroupPaths = {
  s: (row: ConceptRow) => SummaryStats | null
  d: (row: ConceptRow) => DistributionRow[] | null // unwrapped: [0] applied in path
  t: (row: ConceptRow) => Test | null // unwrapped: [0][0] applied in path
}

type StatGroupConfig = {
  id: string
  header: string
  color: string
  effectSizeHeader: string
  effectSizeThreshold: number
  paths: StatGroupPaths
}

// define it outside the component
const ancestorFilterFn: MRT_FilterFn<ConceptRow> = (row, columnId, filterValue: string) => {
  const ids = row.getValue<number[]>(columnId)
  if (!filterValue) return true
  return ids.some((id) => String(id).includes(filterValue))
}

export const countModeLabel = (countMode?: string) => {
  if (countMode === "code") return "Exact code"
  if (countMode === "descendant") return "All descendants"
  return countMode
}
// ─── Factory function ─────────────────────────────────────────────────────────

export function makeStatGroup({
  id,
  header,
  color,
  effectSizeHeader,
  effectSizeThreshold,
  paths,
}: StatGroupConfig): MRT_ColumnDef<ConceptRow> {
  return {
    id,
    header,
    ...groupCellProps(color),

    Header: ({ table }) => (
      <SlopeHeader
        table={table}
        label={header}
        idKey="conceptId"
        dataKey={`mean${id}`}
        getStart={(d: SummaryStats) => d?.meanValueCases ?? 0}
        getEnd={(d: SummaryStats) => d?.meanValueControls ?? 0}
      />
    ),
    columns: [
      {
        id: `mean${id}`,
        header: "Mean",
        ...groupCellProps(color),
        accessorFn: (row) => {
          return paths.s(row) ?? null
          // return s ? `${s.meanValueCases} ${s.meanValueControls}` : null
        },
        Cell: ({ row }) => {
          const s = paths.s(row.original)
          if (!s) return <Typography>N/A</Typography>
          return (
            <CasesControlCell
              cases={s.meanValueCases}
              controls={s.meanValueControls}
              casesSD={s.sdValueCases}
              controlsSD={s.sdValueControls}
            />
          )
        },
        filterVariant: "range",
      },
      {
        id: `distribution${id}`,
        header: "Distribution",
        size: 160,
        ...groupCellProps(color),
        accessorFn: (row) => {
          const s = paths.s(row)
          return s ? `${s.meanValueCases} ${s.meanValueControls}` : null
        },
        Cell: ({ row }) => {
          const s = paths.s(row.original)
          const d = paths.d(row.original)
          if (!s || !d) return <Typography>N/A</Typography>
          return <MeanComparisonChart stats={s} distributions={d} />
        },
        filterVariant: "range",
      },
      {
        id: `-log10${id}`,
        header: "-log10 (p-Value)",
        Header: ({ column }) => (
          <Tooltip title={column.columnDef.header} placement="top">
            <p>-log</p>
          </Tooltip>
        ),
        ...groupCellProps(color),
        accessorFn: (row) => {
          const t = paths.t(row)
          return t ? -Math.log10(t.pValue) : null
        },
        Cell: ({ cell }) => valueChip(cell.getValue<number>(), 8),
        filterVariant: "range",
        sortUndefined: "last",
        // aggregationFn: "max",
        // AggregatedCell: ({ cell }) => (
        //   <>
        //     <p>Max: </p>
        //     <Typography
        //       variant="body2"
        //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
        //     >
        //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
        //     </Typography>
        //   </>
        // ),
      },
      {
        id: `effectSize${id}`,
        header: effectSizeHeader,
        Header: ({ column }) => (
          <Tooltip title={column.columnDef.header} placement="top">
            <p>{column.columnDef.header.slice(0, 2)}</p>
          </Tooltip>
        ),
        ...groupCellProps(color),
        accessorFn: (row) => paths.t(row)?.effectSize ?? null,
        Cell: ({ cell }) => valueChip(cell.getValue<number>(), effectSizeThreshold, { tone: "primary" }),
        filterVariant: "range",
        // aggregationFn: "mean",
        // AggregatedCell: ({ cell }) => (
        //   <>
        //     <p>Mean: </p>
        //     <Typography
        //       variant="body2"
        //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
        //     >
        //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
        //     </Typography>
        //   </>
        // ),
      },
    ],
  }
}

// ─── Stat group configs ───────────────────────────────────────────────────────
// Lives outside the component - no deps on props/state, never triggers re-renders

export const makeInfoColumn = (
  _conceptsById: Record<number, ConceptMetadata>,
): MRT_ColumnDef<ConceptRow> => {
  return {
    id: "main_info",
    header: "Info",
    columns: [
      {
        id: "info",
        header: "Name/ConceptID/Domain",
        Header: ({ column }) => (
          <Tooltip title={column.columnDef.header} placement="top">
            <Info />
          </Tooltip>
        ),

        size: 200,
        minSize: 40,
        maxSize: 300,
        ...groupCellProps(COLUMNS_COLORS.color1),
        accessorFn: (row) =>
          [
            row.conceptId,
            row.conceptName,
            row.sourceConceptCode,
            row.domainId,
            countModeLabel(row.countMode),
          ]
            .filter(Boolean)
            .join(" "),
        enableColumnFilter: false,
        // Filter: ({ table }) => <InfoFilter table={table} />,
        // aggregationFn: "unique",
        // AggregatedCell: ({ cell }) => {
        //   const ancestorId = cell.row.groupingValue as number
        //   const concept = conceptsById[ancestorId]
        //   if (!concept?.conceptName) {
        //     return (
        //       <Box>
        //         <Typography variant="body2" sx={{ fontWeight: "bold" }} noWrap>
        //           Ancestor {ancestorId}
        //         </Typography>
        //         <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
        //           Metadata unavailable in result set
        //         </Typography>
        //       </Box>
        //     )
        //   }
        //   return (
        //     <Box>
        //       <Typography variant="body2" sx={{ fontWeight: "bold" }} noWrap>
        //         {concept.conceptName}
        //       </Typography>
        //       {concept.vocabularyId && concept.conceptCode && (
        //         <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
        //           {concept.vocabularyId}: {concept.conceptCode}
        //         </Typography>
        //       )}
        //       {concept.conceptClassId && (
        //         <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
        //           Class: {concept.conceptClassId}
        //         </Typography>
        //       )}
        //       <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
        //         Concept ID: {concept.conceptId}
        //       </Typography>
        //     </Box>
        //   )
        // },
        Cell: ({ row }) => {
          const concept = row.original
          return (
            <Box
              sx={{
                width: 190,
                color: row.original.isStandard ? "primary.main" : "secondary.main",
              }}
            >
              <Tooltip title={concept.conceptName} placement="right">
                <Typography variant="body2" noWrap>
                  {concept.conceptName}
                </Typography>
              </Tooltip>
              {concept.sourceConceptCode && (
                <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                  Source code: {concept.sourceConceptCode}
                </Typography>
              )}
              <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                Concept ID: {concept.conceptId}
              </Typography>
              {concept.domainId && (
                <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                  Domain: {concept.domainId}
                </Typography>
              )}
              {concept.countMode && (
                <Chip
                  size="small"
                  label={countModeLabel(concept.countMode)}
                  sx={{ mt: 0.5, height: 20, fontSize: 10 }}
                />
              )}
            </Box>
          )
        },
      },
      // Hidden - filter only
      {
        id: "conceptName",
        header: "Name",
        accessorKey: "conceptName",
        filterVariant: "text", // plain string filter, MRT handles it natively
        filterFn: "contains",
        visibleInShowHideMenu: false, // don't clutter the column visibility menu
      },
      {
        id: "conceptId",
        header: "Concept ID",
        accessorKey: "conceptId",
        filterVariant: "text",
        filterFn: "includesString",
        visibleInShowHideMenu: false,
      },
      {
        id: "ancestorConceptIds",
        header: "Ancestor Concept ID",
        Header: ({ column }) => (
          <Tooltip title={column.columnDef.header} placement="top">
            <p>Ancestors</p>
          </Tooltip>
        ),
        accessorKey: "ancestorConceptIds",
        Cell: (row) => (
          <Box>
            {row.cell.getValue<number[]>()?.map((id) => (
              <Typography variant="body2" key={id}>
                {id}
              </Typography>
            ))}
          </Box>
        ),
        filterFn: ancestorFilterFn,
        filterVariant: "text",
        visibleInShowHideMenu: false,
      },
      {
        id: "ancestors",
        header: "Ancestors",
        Header: ({ column }) => (
          <Tooltip title={column.columnDef.header} placement="top">
            <p>Ancestors</p>
          </Tooltip>
        ),
        accessorKey: "ancestorConcepts",
        Cell: (row) => (
          <Box>
            {row.cell.getValue<ConceptMetadata[]>()?.map((c) => (
              <Typography variant="body2" key={c.conceptId}>
                {c.conceptId} - {c.conceptName ?? "N/A"}
              </Typography>
            ))}
          </Box>
        ),
        filterFn: ancestorFilterFn,
        filterVariant: "text",
        visibleInShowHideMenu: false,
      },
      {
        id: "domainId",
        header: "Domain",
        accessorKey: "domainId",
        filterVariant: "multi-select",
        filterFn: "arrIncludesSome",
        visibleInShowHideMenu: false,
      },
    ],
  }
}

// ─── Safe accessors ───────────────────────────────────────────────────────────
// Centralised so Cell and accessorFn always use the same guard logic

const getBinaryCount = (row: ConceptRow) => row.n_Binary?.[0] ?? null
const getBinaryDist = (row: ConceptRow) => row.d_Binary?.[0] ?? null
const getBinaryTest = (row: ConceptRow) => row.t_Binary?.[0]?.[0] ?? null

export const binaryColumn: MRT_ColumnDef<ConceptRow> = {
  id: "Binary",
  header: "Binary",
  ...groupCellProps(COLUMNS_COLORS.color2),
  Header: ({ table }) => (
    <SlopeHeader
      table={table}
      label="Binary"
      idKey="conceptId"
      dataKey="casesControl"
      getStart={(d: BinaryCount) => d?.nCasesWithCategory ?? 0}
      getEnd={(d: BinaryCount) => d?.nControlsWithCategory ?? 0}
    />
  ),
  columns: [
    {
      id: "casesControl",
      header: "Cases / Control",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>C/C</p>
        </Tooltip>
      ),
      ...groupCellProps(COLUMNS_COLORS.color2),
      accessorFn: (row) => {
        return getBinaryCount(row)
      },
      Cell: ({ row }) => {
        const n = getBinaryCount(row.original)
        if (!n) return <Typography>N/A</Typography>
        return (
          <CasesControlCell
            cases={n.nCasesWithCategory}
            controls={n.nControlsWithCategory}
            nDecimals={0}
          />
        )
      },
      // aggregationFn: "sumBinaryCount",

      // AggregatedCell: ({ cell }) => {
      //   const val = cell.getValue<BinaryCount>()
      //   return (
      //     <CasesControlCell
      //       cases={val?.nCasesWithCategory}
      //       controls={val?.nControlsWithCategory}
      //       nDecimals={0}
      //     />
      //   )
      // },
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue<BinaryCount>(columnId)?.nCasesWithCategory ?? 0
        const b = rowB.getValue<BinaryCount>(columnId)?.nCasesWithCategory ?? 0
        return a - b
      },
      filterVariant: "range",
      filterFn: (row, columnId, filterValue) => {
        const [min, max] = filterValue

        // console.log(min)
        // console.log(max)

        const nMin = min ?? 0
        const nMax = max ?? 99999

        const n = row.getValue<BinaryCount>(columnId)
        if (!n) return false

        const val = n.nCasesWithCategory

        if (min !== "" && min !== undefined && val < nMin) return false
        if (max !== "" && max !== undefined && val > nMax) return false
        return true
      },
    },
    {
      id: "proportion",
      header: "Proportion",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>%</p>
        </Tooltip>
      ),
      ...groupCellProps(COLUMNS_COLORS.color2),
      accessorFn: (row) => {
        const dist = getBinaryDist(row)
        if (!dist?.[0] || !dist?.[1]) return null
        return `${dist[0].case} ${dist[0].control}`
      },
      Cell: ({ row }) => {
        const dist = getBinaryDist(row.original)
        if (dist?.[0]?.case === undefined || dist?.[1]?.case === undefined) {
          return <Typography>N/A</Typography>
        }
        const totalCases = dist[0].case + dist[1].case
        const totalControls = dist[0].control + dist[1].control
        return (
          <CategoryBar
            caseCount={dist[0].case}
            controlCount={dist[0].control}
            totalCases={totalCases}
            totalControls={totalControls}
          />
        )
      },
      filterVariant: "range",
    },
    {
      id: "-log10Binary",
      header: "-log10 (p-Value)",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>-log10</p>
        </Tooltip>
      ),
      // aggregationFn: "max",
      // AggregatedCell: ({ cell }) => (
      //   <>
      //     <p>Max: </p>
      //     <Typography
      //       variant="body2"
      //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
      //     >
      //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
      //     </Typography>
      //   </>
      // ),
      ...groupCellProps(COLUMNS_COLORS.color2),
      accessorFn: (row) => {
        const t = getBinaryTest(row)
        if (!t || t.pValue <= 0) return null
        return -Math.log10(t.pValue)
      },
      Cell: ({ cell }) => valueChip(cell.getValue<number>(), 8),
      filterVariant: "range",
      sortUndefined: "last",
    },
    {
      id: "oddsRatioBinary",
      header: "Odds Ratio",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>OR</p>
        </Tooltip>
      ),
      // aggregationFn: "mean",
      // AggregatedCell: ({ cell }) => (
      //   <>
      //     <p>Mean: </p>
      //     <Typography
      //       variant="body2"
      //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
      //     >
      //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
      //     </Typography>
      //   </>
      // ),
      ...groupCellProps(COLUMNS_COLORS.color2),
      accessorFn: (row) => getBinaryTest(row)?.effectSize ?? null,
      Cell: ({ cell }) => valueChip(cell.getValue<number>(), 1.2, { tone: "primary" }),
      filterVariant: "range",
    },
  ],
}

export const STAT_GROUPS: StatGroupConfig[] = [
  {
    id: "Count",
    header: "Count",
    color: COLUMNS_COLORS.color1,
    effectSizeHeader: "Rate Ratio",
    effectSizeThreshold: 1.2,
    paths: {
      s: (row) => row.s_Counts?.[0] ?? null,
      d: (row) => row.d_Counts?.[0]?.[0] ?? null, // DistributionRow[][][0][0] = DistributionRow[]
      t: (row) => row.t_Counts?.[0]?.[0] ?? null,
    },
  },
  {
    id: "Age",
    header: "Age First Event",
    color: COLUMNS_COLORS.color2,
    effectSizeHeader: "Mean Difference",
    effectSizeThreshold: 1.2,
    paths: {
      s: (row) => row.s_AgeFirstEvent?.[0] ?? null,
      d: (row) => row.d_AgeFirstEvent?.[0]?.[0] ?? null,
      t: (row) => row.t_AgeFirstEvent?.[0]?.[0] ?? null,
    },
  },
  {
    id: "Days",
    header: "Days To First Event",
    color: COLUMNS_COLORS.color1,
    effectSizeHeader: "Mean Difference",
    effectSizeThreshold: 1.2,
    paths: {
      s: (row) => row.s_DaysToFirstEvent?.[0] ?? null,
      d: (row) => row.d_DaysToFirstEvent?.[0]?.[0] ?? null,
      t: (row) => row.t_DaysToFirstEvent?.[0]?.[0] ?? null,
    },
  },
  {
    id: "Continuous",
    header: "Continuous",
    color: COLUMNS_COLORS.color2,
    effectSizeHeader: "Variance Ratio",
    effectSizeThreshold: 1.2,
    paths: {
      s: (row) => row.s_Continuous?.[0] ?? null,
      d: (row) => row.d_Continuous?.[0]?.[0] ?? null,
      t: (row) => row.t_Continuous?.[0]?.[0] ?? null,
    },
  },
]

// ─── Safe accessors ───────────────────────────────────────────────────────────

const getCategoricalCount = (row: ConceptRow) => row.n_Categorical?.[0] ?? null
const getCategoricalDist = (row: ConceptRow) => row.d_Categorical?.[0] ?? null // BinaryDistribution[]
const getCategoricalTest = (row: ConceptRow) => row.t_Categorical?.[0]?.[0] ?? null

export const categoryColumn: MRT_ColumnDef<ConceptRow> = {
  id: "Category",
  header: "Category",
  ...groupCellProps(COLUMNS_COLORS.color1), // add color if missing
  columns: [
    {
      id: "casesControlCategory",
      header: "Cases / Controls",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>C/C</p>
        </Tooltip>
      ),
      ...groupCellProps(COLUMNS_COLORS.color1),
      accessorFn: (row) => {
        const n = getCategoricalCount(row)
        return n ? `${n.nCasesWithCategory} ${n.nControlsWithCategory}` : null
      },
      Cell: ({ row }) => {
        const n = getCategoricalCount(row.original)
        if (!n) return <Typography>N/A</Typography>
        return (
          <CasesControlCell
            cases={n.nCasesWithCategory}
            controls={n.nControlsWithCategory}
            nDecimals={0}
          />
        )
      },
      filterVariant: "range",
    },
    {
      id: "distributionCategory",
      header: "Distribution",
      ...groupCellProps(COLUMNS_COLORS.color1),
      accessorFn: (row) => {
        const n = getCategoricalCount(row)
        return n ? `${n.nCasesWithCategory} ${n.nControlsWithCategory}` : null
      },
      Cell: ({ row }) => {
        const n = getCategoricalCount(row.original)
        const d = getCategoricalDist(row.original)
        if (!n || !d) return <Typography>N/A</Typography>
        return (
          <CategoricalDistributionBar
            totalCases={n.nCasesWithCategory}
            totalControls={n.nControlsWithCategory}
            distributions={d}
          />
        )
      },
      filterVariant: "range",
    },
    {
      id: "-log10Category",
      header: "-log10 (p-Value)",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>-log10</p>
        </Tooltip>
      ),
      ...groupCellProps(COLUMNS_COLORS.color1),
      accessorFn: (row) => {
        const t = getCategoricalTest(row)
        if (!t || t.pValue <= 0) return null
        return -Math.log10(t.pValue)
      },
      size: 150,
      Cell: ({ cell }) => valueChip(cell.getValue<number>(), 8),
      filterVariant: "range",
      sortUndefined: "last",
      aggregationFn: "max",
      // AggregatedCell: ({ cell }) => (
      //   <>
      //     <p>Max: </p>
      //     <Typography
      //       variant="body2"
      //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
      //     >
      //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
      //     </Typography>
      //   </>
      // ),
    },
    {
      id: "CramersVCategory",
      header: "Cramers'V",
      Header: ({ column }) => (
        <Tooltip title={column.columnDef.header} placement="top">
          <p>Cram</p>
        </Tooltip>
      ),
      ...groupCellProps(COLUMNS_COLORS.color1),
      accessorFn: (row) => getCategoricalTest(row)?.effectSize ?? null,
      Cell: ({ cell }) => valueChip(cell.getValue<number>(), 1.2, { tone: "primary" }),
      filterVariant: "range",
      // aggregationFn: "mean",
      // AggregatedCell: ({ cell }) => (
      //   <>
      //     <p>Mean: </p>
      //     <Typography
      //       variant="body2"
      //       sx={{ color: "info.main", display: "inline", fontWeight: "bold" }}
      //     >
      //       {cell.getValue<number>()?.toFixed(2) ?? "n/a"}
      //     </Typography>
      //   </>
      // ),
    },
  ],
}

export function useColumns(conceptsById: Record<number, ConceptMetadata>) {
  return useMemo<MRT_ColumnDef<ConceptRow>[]>(() => {
    const infoColumn = makeInfoColumn(conceptsById)
    const cols = [infoColumn, binaryColumn, ...STAT_GROUPS.map(makeStatGroup), categoryColumn]
    return cols
  }, [conceptsById])
}
