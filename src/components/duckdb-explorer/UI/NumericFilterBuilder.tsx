import { Add, Close, FilterList } from "@mui/icons-material"
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material"
import type { MRT_Column, MRT_RowData, MRT_TableInstance } from "material-react-table"
import { useState } from "react"
import { isFilterNumber } from "../queryBuilders"

// Block-based editor for the numeric column filters. The operator and the AND/OR connectors are
// picked from fixed controls and only the number is typed, so the expression can't be malformed.
// It still reads and writes the plain string form ("> 5 AND < 10") that parseNumericFilter,
// buildFilterConditions, the filter chips and saved presets all understand.

type Operator = ">=" | ">" | "=" | "<" | "<="
type Connector = "AND" | "OR"
type Clause = { connector: Connector; operator: Operator; value: string }

const OPERATORS: { value: Operator; label: string }[] = [
  { value: ">=", label: "≥" },
  { value: ">", label: ">" },
  { value: "=", label: "=" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
]
const OPERATOR_LABEL = Object.fromEntries(OPERATORS.map((o) => [o.value, o.label])) as Record<
  Operator,
  string
>

// Characters the value box accepts while typing. Transient states like "-" or "5." are allowed here
// and simply left out of the expression until they become a full number.
const PARTIAL_NUMBER = /^-?\d*\.?\d*$/

const newClause = (connector: Connector = "AND"): Clause => ({
  connector,
  operator: ">=",
  value: "",
})

function parseClauses(text: string): Clause[] {
  const trimmed = text.trim()
  if (!trimmed) return [newClause()]
  // Capturing split keeps the connectors: [part, connector, part, connector, part, ...].
  const tokens = trimmed.split(/\s*(\|\||&&|\band\b|\bor\b)\s*/i)
  const clauses: Clause[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    const rawConnector = i === 0 ? "AND" : tokens[i - 1]
    const connector: Connector = /^(or|\|\|)$/i.test(rawConnector) ? "OR" : "AND"
    const match = tokens[i].match(/^(<=|>=|<|>|=)?\s*(.*)$/)
    clauses.push({
      connector,
      operator: (match?.[1] as Operator | undefined) ?? "=",
      value: match?.[2] ?? "",
    })
  }
  return clauses
}

// Only complete numbers make it into the expression; a clause still being typed is skipped rather
// than producing a string the parser would reject (which would drop the whole filter).
function serializeClauses(clauses: Clause[]) {
  let out = ""
  for (const clause of clauses) {
    if (!isFilterNumber(clause.value)) continue
    const part = `${clause.operator} ${Number(clause.value)}`
    out = out ? `${out} ${clause.connector} ${part}` : part
  }
  return out
}

function prettyExpression(text: string) {
  return text.replace(/>=/g, "≥").replace(/<=/g, "≤")
}

type NumericFilterBuilderProps<TData extends MRT_RowData> = {
  column: MRT_Column<TData, unknown>
  table: MRT_TableInstance<TData>
}

export function NumericFilterBuilder<TData extends MRT_RowData>({
  column,
  table,
}: NumericFilterBuilderProps<TData>) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [clauses, setClauses] = useState<Clause[]>([newClause()])

  const filterValue = String(column.getFilterValue() ?? "")
  const parentHeader = column.parent?.columnDef.header
  const title = parentHeader
    ? `${parentHeader} · ${column.columnDef.header}`
    : column.columnDef.header
  const isLogP = column.id.endsWith("LogP")
  const applyFilters = (table.options.meta as { applyFilters?: () => void } | undefined)
    ?.applyFilters

  const open = (event: React.MouseEvent<HTMLElement>) => {
    // Re-read on every open so chips, presets and "clear all" edits made elsewhere show up here.
    setClauses(parseClauses(filterValue))
    setAnchorEl(event.currentTarget)
  }

  const update = (next: Clause[]) => {
    setClauses(next)
    const serialized = serializeClauses(next)
    // This is the draft filter: it waits for Apply like every other filter input.
    column.setFilterValue(serialized || undefined)
  }

  const patch = (index: number, changes: Partial<Clause>) =>
    update(clauses.map((clause, i) => (i === index ? { ...clause, ...changes } : clause)))

  const remove = (index: number) => {
    const next = clauses.filter((_, i) => i !== index)
    update(next.length > 0 ? next : [newClause()])
  }

  const apply = () => {
    applyFilters?.()
    setAnchorEl(null)
  }

  const hasIncomplete = clauses.some((c) => c.value.trim() !== "" && !isFilterNumber(c.value))

  return (
    <>
      <Tooltip title={filterValue ? prettyExpression(filterValue) : "Add filter"} placement="top">
        <ButtonBase
          onClick={open}
          sx={{
            width: "100%",
            minWidth: 0,
            justifyContent: "flex-start",
            gap: 0.25,
            px: 0.5,
            py: 0.25,
            borderRadius: 1,
            border: 1,
            borderColor: filterValue ? "primary.main" : "divider",
            color: filterValue ? "text.primary" : "text.secondary",
            fontSize: "0.7rem",
          }}
        >
          <FilterList sx={{ fontSize: 14, flexShrink: 0 }} />
          <Box
            component="span"
            sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {filterValue ? prettyExpression(filterValue) : "Any"}
          </Box>
        </ButtonBase>
      </Tooltip>

      <Popover
        open={anchorEl != null}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 1.5, width: 280 } } }}
      >
        <Stack spacing={1}>
          <Box>
            <Typography variant="subtitle2">{title}</Typography>
            {isLogP && (
              <Typography variant="caption" color="text.secondary">
                Values are −log10(p): ≥ 5 means p ≤ 1e-5
              </Typography>
            )}
          </Box>

          {clauses.map((clause, index) => (
            <Stack key={index} spacing={0.75}>
              {index > 0 && (
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <Tooltip title="Click to switch AND / OR">
                    <Chip
                      size="small"
                      label={clause.connector}
                      color={clause.connector === "OR" ? "secondary" : "primary"}
                      variant="outlined"
                      onClick={() =>
                        patch(index, { connector: clause.connector === "AND" ? "OR" : "AND" })
                      }
                      sx={{ fontWeight: 600, minWidth: 48 }}
                    />
                  </Tooltip>
                </Box>
              )}
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Select
                  size="small"
                  value={clause.operator}
                  onChange={(event) => patch(index, { operator: event.target.value as Operator })}
                  renderValue={(value) => OPERATOR_LABEL[value]}
                  sx={{ width: 64, flexShrink: 0 }}
                >
                  {OPERATORS.map((op) => (
                    <MenuItem key={op.value} value={op.value}>
                      {op.label}
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  size="small"
                  placeholder="value"
                  value={clause.value}
                  autoFocus={index === clauses.length - 1}
                  error={clause.value.trim() !== "" && !isFilterNumber(clause.value)}
                  onChange={(event) => {
                    const next = event.target.value.trim()
                    if (PARTIAL_NUMBER.test(next)) patch(index, { value: next })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") apply()
                  }}
                  slotProps={{ htmlInput: { inputMode: "decimal" } }}
                  sx={{ flex: 1 }}
                />
                <IconButton size="small" onClick={() => remove(index)} aria-label="Remove condition">
                  <Close fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          ))}

          <Stack direction="row" spacing={0.5}>
            <Button size="small" startIcon={<Add />} onClick={() => update([...clauses, newClause("AND")])}>
              AND
            </Button>
            <Button size="small" startIcon={<Add />} onClick={() => update([...clauses, newClause("OR")])}>
              OR
            </Button>
          </Stack>

          {clauses.length > 2 && (
            <Typography variant="caption" color="text.secondary">
              AND is evaluated before OR.
            </Typography>
          )}
          {hasIncomplete && (
            <Typography variant="caption" color="error">
              Incomplete values are ignored.
            </Typography>
          )}

          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button size="small" onClick={() => update([newClause()])}>
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={apply}>
              Apply
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  )
}
