import { useState, type Dispatch, type SetStateAction } from "react"
import { Badge, Box, Button, Divider, Stack } from "@mui/material"
import type { MRT_ColumnFiltersState, MRT_TableInstance } from "material-react-table"
import type { FilterPreset } from "../../utils/types"
import { FilterChips, type ActiveFilter } from "../filters/FilterChips"
import { FilterPresets } from "../filters/FilterPresets"
import { loadPresets, savePresets } from "../filters/presetStorage"
import type { ConceptSummaryRow } from "./types"

const STORAGE_KEY = "duckdb-filter-presets"
const DEFAULT_COUNT_MODE = "descendant"
const DEFAULT_DOMAIN = "all"

// Synthetic ids for the non-column filter dimensions, so they can be toggled
// individually in the save modal alongside the MRT column filters.
const COUNT_MODE_ID = "__countMode"
const DOMAIN_ID = "__selectedDomain"
const SEARCH_ID = "__searchText"

type DuckDbFilterBarProps = {
  table: MRT_TableInstance<ConceptSummaryRow>
  // The chips reflect the *applied* (active) filters; commit* helpers update draft + applied at once
  // so chip/clear/preset actions take effect immediately without a separate Apply click.
  appliedColumnFilters: MRT_ColumnFiltersState
  commitColumnFilters: (next: MRT_ColumnFiltersState) => void
  countMode: string
  setCountMode: Dispatch<SetStateAction<string>>
  selectedDomain: string
  setSelectedDomain: Dispatch<SetStateAction<string>>
  appliedSearchText: string
  commitSearchText: (next: string) => void
  isDirty: boolean
  onApply: () => void
  rowCount: number
}

function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.some((v) => v !== undefined && v !== "")
  return true
}

export function DuckDbFilterBar({
  table,
  appliedColumnFilters,
  commitColumnFilters,
  countMode,
  setCountMode,
  selectedDomain,
  setSelectedDomain,
  appliedSearchText,
  commitSearchText,
  isDirty,
  onApply,
}: DuckDbFilterBarProps) {
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets(STORAGE_KEY))
  const [selectedPresetId, setSelectedPresetId] = useState<string>("")

  const columnFilterEntries: ActiveFilter[] = appliedColumnFilters
    .filter((f) => isFilterActive(f.value))
    .map((f) => ({
      id: f.id,
      label: String(table.getColumn(f.id)?.columnDef.header ?? f.id),
      value: Array.isArray(f.value) ? `${f.value[0]} - ${f.value[1]}` : String(f.value),
      onClear: () => commitColumnFilters(appliedColumnFilters.filter((c) => c.id !== f.id)),
    }))

  const extraEntries: ActiveFilter[] = []
  if (countMode !== DEFAULT_COUNT_MODE) {
    extraEntries.push({
      id: COUNT_MODE_ID,
      label: "Count Mode",
      value: countMode,
      onClear: () => setCountMode(DEFAULT_COUNT_MODE),
    })
  }
  if (selectedDomain !== DEFAULT_DOMAIN) {
    extraEntries.push({
      id: DOMAIN_ID,
      label: "Domain",
      value: selectedDomain,
      onClear: () => setSelectedDomain(DEFAULT_DOMAIN),
    })
  }
  if (appliedSearchText.trim() !== "") {
    extraEntries.push({
      id: SEARCH_ID,
      label: "Search",
      value: appliedSearchText,
      onClear: () => commitSearchText(""),
    })
  }

  const activeFilters = [...columnFilterEntries, ...extraEntries]

  const handleClearAll = () => {
    commitColumnFilters([])
    setCountMode(DEFAULT_COUNT_MODE)
    setSelectedDomain(DEFAULT_DOMAIN)
    commitSearchText("")
  }

  const handleSave = (name: string, includedIds: string[]) => {
    const preset: FilterPreset = {
      id: String(Date.now()),
      name,
      filters: appliedColumnFilters
        .filter((f) => isFilterActive(f.value))
        .filter((f) => includedIds.includes(f.id)),
    }
    if (includedIds.includes(COUNT_MODE_ID)) preset.countMode = countMode
    if (includedIds.includes(DOMAIN_ID)) preset.selectedDomain = selectedDomain
    if (includedIds.includes(SEARCH_ID)) preset.searchText = appliedSearchText
    const updated = [...presets, preset]
    setPresets(updated)
    savePresets(STORAGE_KEY, updated)
  }

  const handleDelete = (id: string) => {
    const updated = presets.filter((p) => p.id !== id)
    setPresets(updated)
    savePresets(STORAGE_KEY, updated)
  }

  const handleEdit = (edited: FilterPreset) => {
    // FilterPresets only edits name + column filters; preserve the snapshot extras.
    const next = presets.map((p) =>
      p.id === edited.id ? { ...p, name: edited.name, filters: edited.filters } : p,
    )
    setPresets(next)
    savePresets(STORAGE_KEY, next)
  }

  const handleApply = (preset: FilterPreset) => {
    setSelectedPresetId(preset.id)
    commitColumnFilters(preset.filters)
    setCountMode(preset.countMode ?? DEFAULT_COUNT_MODE)
    setSelectedDomain(preset.selectedDomain ?? DEFAULT_DOMAIN)
    commitSearchText(preset.searchText ?? "")
  }

  return (
    <Stack
      direction={"row"}
      spacing={"auto"}
      sx={{
        width: "100%",
        alignItems: "center",
        // flexWrap: "wrap",
        p: 1,
      }}
    >
      <FilterChips filters={activeFilters} onClearAll={handleClearAll} onSave={handleSave} />
      {presets.length > 0 && <Divider orientation="vertical" flexItem />}
      <FilterPresets
        presets={presets}
        selectedPresetId={selectedPresetId}
        onApply={handleApply}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />
      {presets && <Divider orientation="vertical" flexItem />}
      <Badge color="warning" variant="dot" invisible={!isDirty}>
        <Button
          size="small"
          variant={isDirty ? "contained" : "outlined"}
          color="primary"
          disabled={!isDirty}
          onClick={onApply}
        >
          Apply
        </Button>
      </Badge>
    </Stack>
  )
}
