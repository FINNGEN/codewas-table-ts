import { Box, Chip, Stack, Typography } from "@mui/material"
import { alpha, type Theme } from "@mui/material/styles"
import type { MRT_ColumnDef, MRT_FilterFn } from "material-react-table"
import { CasesControlCell } from "../../table/custom-cells/CasesControlsCell"
import { CategoryBar, CategoricalDistributionBar, MeanComparisonChart } from "../Visuals"
import { matchesNumericFilter, parseNumericFilter } from "./queryBuilders"
import type { ConceptSummaryRow } from "./types"
import { NumericFilterBuilder } from "./UI/NumericFilterBuilder"
import {
  MAX_NEG_LOG10,
  buildDistributionRows,
  buildStats,
  negLog10,
  parseCategoricalDistribution,
} from "./utils/utils"
import { AccountTreeRounded } from "@mui/icons-material"

export const numericExpressionFilter: MRT_FilterFn<ConceptSummaryRow> = (
  row,
  columnId,
  filterValue,
) => {
  const rawValue = row.getValue<number | null>(columnId)
  const value = typeof rawValue === "number" ? rawValue : null
  const filterText = String(filterValue ?? "").trim()
  if (!filterText) return true
  const parsed = parseNumericFilter(filterText)
  if (!parsed || value == null || Number.isNaN(value)) return false
  return matchesNumericFilter(value, parsed)
}

// Shared by every numeric stat column: the block-based builder replaces MRT's plain text input.
const numericFilterProps: Pick<MRT_ColumnDef<ConceptSummaryRow>, "filterFn" | "Filter"> = {
  filterFn: numericExpressionFilter,
  Filter: ({ column, table }) => <NumericFilterBuilder column={column} table={table} />,
}

function NA_Chip() {
  return (
    <Typography variant="body2" sx={{ opacity: 0.25 }}>
      N/A
    </Typography>
  )
}

// Which palette channel a threshold chip highlights with. Purple is reserved for
// significance, so effect sizes pass "primary" and read as a different kind of number.
type ChipTone = "pvalue" | "primary"

export function valueChip(
  value: number | null | undefined,
  threshold: number,
  { digits = 2, tone = "pvalue" }: { digits?: number; tone?: ChipTone } = {},
) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <NA_Chip />
    // return value
  }
  const highlight = value >= threshold
  return (
    <Chip
      label={value === Infinity ? "∞" : value.toFixed(digits)}
      size="small"
      // Tint from `main` instead of the `light` step: one hue definition covers both schemes,
      // where a fixed `light` would be the wrong end of the ramp in dark mode. `undefined`
      // (not "default", which is not a color) leaves below-threshold chips on Chip's own style.
      sx={(theme) => ({
        backgroundColor: highlight ? alpha(theme.palette[tone].main, 0.16) : undefined,
        color: highlight ? theme.palette[tone].main : undefined,
        fontWeight: highlight ? 600 : undefined,
      })}
    />
  )
}

// -log10(p) threshold above which the chip turns purple (genome-wide-significance style cutoff).
const LOG_P_THRESHOLD = 8

// Cell renderer for the -log10(p) columns. A value sitting at the underflow ceiling means the
// p-value was exported as 0, so it shows as a lower bound instead of a spuriously precise "323.31".
function logPChip(value: number | null | undefined) {
  if (value != null && !Number.isNaN(value) && value >= MAX_NEG_LOG10) {
    return (
      <Chip label={`>${MAX_NEG_LOG10.toFixed(0)}`} size="small" color="pvalue" variant="outlined" />
    )
  }
  return valueChip(value, LOG_P_THRESHOLD)
}

export function makeContinuousColumns(
  header: string,
  colorThreshold: number,
  prefix: "counts" | "age" | "days" | "continuous",
): MRT_ColumnDef<ConceptSummaryRow> {
  return {
    id: prefix,
    header,
    columns: [
      {
        id: `${prefix}Mean`,
        header: "Mean",
        accessorFn: (row) => row[`${prefix}CaseMean` as keyof ConceptSummaryRow] as number | null,
        ...numericFilterProps,
        Cell: ({ row }) => {
          const caseMean = row.original[`${prefix}CaseMean` as keyof ConceptSummaryRow] as
            | number
            | null
          const controlMean = row.original[`${prefix}ControlMean` as keyof ConceptSummaryRow] as
            | number
            | null
          const caseSd = row.original[`${prefix}CaseSd` as keyof ConceptSummaryRow] as number | null
          const controlSd = row.original[`${prefix}ControlSd` as keyof ConceptSummaryRow] as
            | number
            | null
          if (caseMean == null || controlMean == null || caseSd == null || controlSd == null) {
            return <NA_Chip />
          }
          return (
            <CasesControlCell
              cases={caseMean}
              controls={controlMean}
              casesSD={caseSd}
              controlsSD={controlSd}
            />
          )
        },
        size: 50,
      },
      {
        id: `${prefix}Distribution`,
        header: "Dist",
        accessorFn: (row) => row[`${prefix}CaseMean` as keyof ConceptSummaryRow] as number | null,
        Cell: ({ row }) => {
          const stats = buildStats(
            row.original[`${prefix}CaseMean` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}ControlMean` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}CaseSd` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}ControlSd` as keyof ConceptSummaryRow] as number | null,
          )
          const distributions = buildDistributionRows(
            row.original[`${prefix}P10Case` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P25Case` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}MedianCase` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P75Case` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P90Case` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P10Control` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P25Control` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}MedianControl` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P75Control` as keyof ConceptSummaryRow] as number | null,
            row.original[`${prefix}P90Control` as keyof ConceptSummaryRow] as number | null,
          )
          if (!stats || !distributions) return <NA_Chip />
          return (
            <MeanComparisonChart
              stats={stats}
              distributions={distributions}
              unit={
                prefix === "continuous"
                  ? ((row.original.continuousUnit as string | null) ?? "")
                  : ""
              }
            />
          )
        },
        size: 50,
      },
      {
        id: `${prefix}LogP`,
        header: "pVal",
        accessorFn: (row) =>
          negLog10(row[`${prefix}PValue` as keyof ConceptSummaryRow] as number | null),
        ...numericFilterProps,
        Cell: ({ cell }) => logPChip(cell.getValue<number | null>()),
        size: 50,
      },
      {
        id: `${prefix}Effect`,
        header: "Eff.",
        accessorFn: (row) => row[`${prefix}EffectSize` as keyof ConceptSummaryRow] as number | null,
        ...numericFilterProps,
        Cell: ({ cell }) => valueChip(cell.getValue<number | null>(), colorThreshold),
        size: 50,
      },
    ],
  }
}

// Faint wash used to separate adjacent column groups. Translucent on purpose: MRT applies our sx last,
// so an opaque color would hide the row-level tints (focus highlight, hierarchy depth) painted on <tr>.
const groupShadeSx = (theme: Theme) => ({
  backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.07 : 0.04),
})

// Shade every other top-level group (Binary, Age First Event, Continuous) plus its leaf columns, so the
// analysis blocks read as bands instead of one continuous grid.
function withAlternatingGroupShading(
  groups: MRT_ColumnDef<ConceptSummaryRow>[],
): MRT_ColumnDef<ConceptSummaryRow>[] {
  return groups.map((group, index) => {
    if (index % 2 === 0) return group
    return {
      ...group,
      muiTableHeadCellProps: { sx: groupShadeSx },
      columns: group.columns?.map((column) => ({
        ...column,
        muiTableHeadCellProps: { sx: groupShadeSx },
        muiTableBodyCellProps: { sx: groupShadeSx },
      })),
    }
  })
}

export function buildColumns(): MRT_ColumnDef<ConceptSummaryRow>[] {
  return withAlternatingGroupShading([
    {
      id: "info",
      // accessorKey: "info",
      header: "Info",
      columns: [
        {
          id: "conceptInfo",
          accessorKey: "conceptInfo",
          header: "Concept",
          accessorFn: (row) =>
            [
              row.conceptName ?? "",
              row.conceptCode ?? "",
              String(row.conceptId),
              row.domainId,
              row.countMode,
            ].join(" "),
          Cell: ({ row }) => (
            <Stack
              spacing={0.25}
              sx={{
                pl: row.depth * 1.5,
                borderLeft: row.depth > 0 ? "3px solid" : "none",
                borderColor:
                  row.depth > 0
                    ? `rgba(25, 118, 210, ${Math.min(0.18 + row.depth * 0.08, 0.42)})`
                    : "transparent",
              }}
            >
              <Stack
                direction={"row"}
                spacing={1}
                sx={{
                  color: "primary.main",
                  fontWeight: 700,
                  // justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    // Names run long, so they wrap inside the column's fixed width instead of
                    // spilling out of it. Compact density puts `nowrap` on every body cell, and a
                    // flex child won't shrink past its longest word on its own — hence all three.
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    minWidth: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {row.original.conceptName ?? row.original.conceptId}
                </Typography>
                {row.original.countMode === "descendant" && (
                  <AccountTreeRounded fontSize="xs" sx={{ flexShrink: 0 }} />
                )}
              </Stack>
              <Stack direction={"row"}>
                <Typography variant="caption" color="text.secondary">
                  {row.original.conceptCode ?? "N/A"}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                  |
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.original.domainId}
                </Typography>
              </Stack>
              {/* <Typography variant="body2" color="text.secondary">
                Concept ID: {row.original.conceptId}
              </Typography> */}
              {/* TODO Icon not chip */}
              <Box>
                {/* <Chip
                  size="small"
                  label={row.original.countMode === "descendant" ? "All descendants" : "Exact code"}
                  // variant="outlined"
                /> */}

                {row.depth > 0 && (
                  <Chip
                    size="small"
                    label={`Level ${row.depth + 1}`}
                    variant="outlined"
                    sx={{ ml: 0.5 }}
                  />
                )}
              </Box>
            </Stack>
          ),
          size: 240,
        },
        {
          accessorKey: "ancestorConceptIds",
          header: "Ancestors",
          size: 200,
          Cell: ({ cell }) => {
            const value = cell.getValue<string | null>()
            if (!value) return <NA_Chip />
            return (
              <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                {value.split(",").join("\n")}
              </Typography>
            )
          },
        },
      ],
    },
    {
      id: "binary",
      header: "Binary",
      columns: [
        {
          id: "binaryCasesControl",
          header: "C/C",
          // enableColumnActions: false,
          // enableColumnOrdering: false,
          accessorFn: (row) => row.binaryCaseYes ?? null,
          ...numericFilterProps,
          Cell: ({ row }) =>
            row.original.binaryCaseYes != null && row.original.binaryControlYes != null ? (
              <CasesControlCell
                cases={row.original.binaryCaseYes}
                controls={row.original.binaryControlYes}
                nDecimals={0}
              />
            ) : (
              <NA_Chip />
            ),
          size: 50,
        },
        {
          id: "binaryDistribution",
          header: "Dist",
          accessorFn: (row) => row.binaryCaseYes ?? null,
          Cell: ({ row }) => {
            const caseCount = row.original.binaryCaseYes
            const controlCount = row.original.binaryControlYes
            const totalCases = row.original.binaryTotalCases
            const totalControls = row.original.binaryTotalControls
            if (
              caseCount == null ||
              controlCount == null ||
              totalCases == null ||
              totalControls == null
            ) {
              return <NA_Chip />
            }
            return (
              <CategoryBar
                caseCount={caseCount}
                controlCount={controlCount}
                totalCases={totalCases}
                totalControls={totalControls}
              />
            )
          },
          size: 50,
        },
        {
          id: "binaryLogP",
          header: "pVal",
          accessorFn: (row) => negLog10(row.binaryPValue),
          ...numericFilterProps,
          Cell: ({ cell }) => logPChip(cell.getValue<number | null>()),
          size: 80,
        },
        {
          id: "binaryEffect",
          header: "OR",
          accessorFn: (row) => row.binaryEffectSize ?? null,
          ...numericFilterProps,
          Cell: ({ cell }) => valueChip(cell.getValue<number | null>(), 1.2, { tone: "primary" }),
          size: 80,
        },
      ],
    },
    makeContinuousColumns("Counts", 1.1, "counts"),
    makeContinuousColumns("Age First Event", 1.1, "age"),
    makeContinuousColumns("Days To First Event", 1.1, "days"),
    makeContinuousColumns("Continuous", 1.1, "continuous"),
    {
      id: "categorical",
      header: "Categorical",
      columns: [
        {
          id: "categoricalCasesControl",
          header: "C/C",
          accessorFn: (row) => row.categoricalCaseYes ?? null,
          ...numericFilterProps,
          Cell: ({ row }) =>
            row.original.categoricalCaseYes != null &&
            row.original.categoricalControlYes != null ? (
              <CasesControlCell
                cases={row.original.categoricalCaseYes}
                controls={row.original.categoricalControlYes}
                nDecimals={0}
              />
            ) : (
              <NA_Chip />
            ),
          size: 50,
        },
        {
          id: "categoricalDistribution",
          header: "Dist",
          accessorFn: (row) => row.categoricalDistribution ?? null,
          Cell: ({ row }) => {
            const distributions = parseCategoricalDistribution(row.original.categoricalDistribution)
            if (distributions.length === 0) return <NA_Chip />
            return (
              <CategoricalDistributionBar
                totalCases={row.original.categoricalCaseYes ?? 0}
                totalControls={row.original.categoricalControlYes ?? 0}
                distributions={distributions}
              />
            )
          },
          size: 50,
        },
        {
          id: "categoricalLogP",
          header: "pVal",
          accessorFn: (row) => negLog10(row.categoricalPValue),
          ...numericFilterProps,
          Cell: ({ cell }) => logPChip(cell.getValue<number | null>()),
          size: 50,
        },
        {
          id: "categoricalEffect",
          header: "Effect",
          accessorFn: (row) => row.categoricalEffectSize ?? null,
          ...numericFilterProps,
          Cell: ({ cell }) => valueChip(cell.getValue<number | null>(), 1.2, { tone: "primary" }),
          size: 50,
        },
      ],
    },
  ])
}
