import { Box, Table, TableBody, TableCell, TableContainer, TableRow, Tooltip } from "@mui/material"
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
    <TableContainer
      component={Box}
      sx={{ width: 360, minWidth: 360, maxWidth: 360, flexShrink: 0, overflow: "hidden" }}
    >
      <Table size="small" aria-label="cohorts info" sx={{ width: 360, tableLayout: "fixed" }}>
        <TableBody>
          {cohorts.map((cohort) => (
            <TableRow key={cohort.cohortId}>
              <TableCell
                sx={{
                  ...cellSx,
                  width: 240,
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <Tooltip title={cohort.cohortName} placement="top-start">
                  <Box component="span">{cohort.cohortName}</Box>
                </Tooltip>
              </TableCell>
              {/* <TableCell sx={cellSx}>{cohort.shortName}</TableCell> */}
              <TableCell
                sx={{
                  ...cellSx,
                  width: 50,
                  color: `${cohort.cohortUse}.main`,
                  fontWeight: 700,
                }}
              >
                {cohort.cohortUse}
              </TableCell>
              <TableCell sx={{ ...cellSx, width: 70 }} align="right">
                <Tooltip title="Sample size" placement="top-end">
                  <Box component="span">
                    n={cohort.cohortSubjects?.toLocaleString() ?? "N/A"}
                  </Box>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
