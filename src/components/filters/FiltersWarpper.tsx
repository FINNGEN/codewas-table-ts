import type { MRT_TableInstance } from "material-react-table"
import type { ConceptRow, FilterPreset } from "../../utils/types"
import { useState } from "react"
import { Box, Divider } from "@mui/material"
import { FilterChips, type ActiveFilter } from "./FilterChips"
import { FilterPresets } from "./FilterPresets"
import { loadPresets, savePresets } from "./presetStorage"

const STORAGE_KEY = "mrt-filter-presets"

function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.some((v) => v !== undefined && v !== "")
  return true
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `${value[0]} - ${value[1]}`
  return String(value)
}

// FilterWrapper.tsx
export function FilterWrapper({ table }: { table: MRT_TableInstance<ConceptRow> }) {
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets(STORAGE_KEY))
  const [selectedPresetId, setSelectedPresetId] = useState<string>("")

  const activeFilters: ActiveFilter[] = table
    .getState()
    .columnFilters.filter((f) => isFilterActive(f.value))
    .map((f) => {
      const column = table.getColumn(f.id)
      return {
        id: f.id,
        label: String(column?.columnDef.header ?? f.id),
        value: formatValue(f.value),
        onClear: () => column?.setFilterValue(undefined),
      }
    })

  const handleSave = (name: string, includedIds: string[]) => {
    const columnFilters = table.getState().columnFilters.filter((f) => isFilterActive(f.value))
    const updated = [
      ...presets,
      {
        id: String(Date.now()),
        name,
        filters: columnFilters.filter((f) => includedIds.includes(f.id)),
      },
    ]
    setPresets(updated)
    savePresets(STORAGE_KEY, updated)
  }

  const handleDelete = (id: string) => {
    const updated = presets.filter((p) => p.id !== id)
    setPresets(updated)
    savePresets(STORAGE_KEY, updated)
  }

  const handleEdit = (updated: FilterPreset) => {
    const next = presets.map((p) => (p.id === updated.id ? updated : p))
    setPresets(next)
    savePresets(STORAGE_KEY, next)
  }

  const handleApply = (preset: FilterPreset) => {
    setSelectedPresetId(preset.id)
    table.setColumnFilters(preset.filters)
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        alignItems: "center",
        minHeight: 100,
      }}
    >
      {/* <FilterStats table={table} /> */}
      <Box
        sx={{
          display: "flex",
          gap: 2,
          alignItems: "center",
        }}
      >
        <FilterChips
          filters={activeFilters}
          onClearAll={() => table.resetColumnFilters()}
          onSave={handleSave}
        />
        {activeFilters.length > 0 && <Divider orientation="vertical" flexItem />}
        <FilterPresets
          presets={presets}
          selectedPresetId={selectedPresetId}
          onApply={handleApply}
          onDelete={handleDelete}
          onEdit={handleEdit}
        />
      </Box>
    </Box>
  )
}
