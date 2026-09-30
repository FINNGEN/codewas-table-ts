import { Table, TableBody, TableCell, TableContainer, TableRow, Box } from "@mui/material"
import type { CohortInfoIndex } from "./types"

type CohortsInfoTableProps = {
  cohortsInfo: CohortInfoIndex
}

// This is a page header, not a data grid: there is one row per cohort (cases / controls), so it is
// styled as a slim legend - borderless, tight padding, and sized to its content rather than the full
// width. MUI's `size="small"` still pads 6px vertically, hence the explicit `py`.

const cellSx = {
  border: 0,
  py: 0.25,
  px: 0.5,
  whiteSpace: "nowrap",
  fontSize: 12,
} as const

export function CohortsInfoTable({ cohortsInfo }: CohortsInfoTableProps) {
  const cohorts = Object.values(cohortsInfo).filter((c) => c.cohortUse)
  if (cohorts.length === 0) return null

  return (
    <TableContainer component={Box} sx={{ width: "auto", minWidth: "350px", maxWidth: "500px" }}>
      <Table size="small" aria-label="cohorts info">
        <TableBody>
          {cohorts.map((cohort) => (
            <TableRow key={cohort.cohortId}>
              <TableCell sx={cellSx}>{cohort.cohortName}</TableCell>
              {/* <TableCell sx={cellSx}>{cohort.shortName}</TableCell> */}
              <TableCell sx={{ ...cellSx, color: `${cohort.cohortUse}.main`, fontWeight: 700 }}>
                {cohort.cohortUse}
              </TableCell>
              <TableCell sx={cellSx} align="right">
                {cohort.cohortSubjects?.toLocaleString() ?? "N/A"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
