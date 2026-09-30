import { Chip, Typography } from "@mui/material"
import type { MRT_ColumnDef } from "material-react-table"
import type { ConceptRow } from "../utils/types"

// Mirrors the DuckDb-mode chip tones (see duckdb-explorer/tableColumns): purple means
// significance, blue means effect size.
type ChipTone = "pvalue" | "primary"

export const valueChip = (
  value: number | null,
  threshold: number,
  { tone = "pvalue" }: { tone?: ChipTone } = {},
) => {
  if (value === null) return <Chip label="n/a" size="small" />

  // Full palette paths, not bare channel names: `color="success"` resolves to the palette
  // *object* and silently emits nothing.
  const color = value >= threshold ? `${tone}.main` : "text.disabled"

  // return <Chip label={fmt(value)} size="small" color={color} />
  return (
    <Typography variant="body2" sx={{ color }}>
      {fmt(value)}
    </Typography>
  )
}

export function groupCellProps(color: string): Partial<MRT_ColumnDef<ConceptRow>> {
  return {
    muiTableBodyCellProps: { sx: { backgroundColor: color } },
    muiTableHeadCellProps: {
      sx: {
        backgroundColor: color,

        "& .Mui-TableHeadCell-Content-Wrapper": {
          // transform: "rotate(-45deg)",
        },
        "& .MuiCollapse-wrapperInner": {
          display: "flex",
          flexDirection: "column",
          gap: 1,
          p: 1,
        },
        "& .MuiCollapse-wrapperInner > .MuiBox-root": {
          display: "flex",
          gap: 0.5,
          flexDirection: "column",
          width: "100%",
        },
      },
    },
  }
}

const fmt = (v: number | null, decimals = 4): string => (v === null ? "-" : v.toFixed(decimals))
