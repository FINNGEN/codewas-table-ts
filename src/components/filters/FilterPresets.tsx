import type { FilterPreset } from "../../utils/types"
import { useState } from "react"
import {
  Box,
  Chip,
  Modal,
  Typography,
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  Divider,
} from "@mui/material"
import { Edit } from "@mui/icons-material"

type FilterPresetsProps = {
  presets: FilterPreset[]
  selectedPresetId: string
  onApply: (preset: FilterPreset) => void
  onDelete: (id: string) => void
  onEdit: (updated: FilterPreset) => void
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `${value[0]} - ${value[1]}`
  return String(value)
}

const modalStyle = {
  position: "absolute" as const,
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 400,
  bgcolor: "background.paper",
  border: "2px solid",
  borderColor: "divider",
  boxShadow: 24,
  p: 4,
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
}

export function FilterPresets({
  presets,
  selectedPresetId,
  onApply,
  onDelete,
  onEdit,
}: FilterPresetsProps) {
  const [editingPreset, setEditingPreset] = useState<FilterPreset | null>(null)
  const [editName, setEditName] = useState("")
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const handleOpenEdit = (preset: FilterPreset) => {
    setEditingPreset(preset) // no merge, use preset as-is
    setEditName(preset.name)
    setCheckedIds(new Set(preset.filters.map((f) => f.id))) // pre-check all saved filters
  }

  const handleCloseEdit = () => {
    setEditingPreset(null)
    setEditName("")
    setCheckedIds(new Set())
  }

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSaveEdit = () => {
    if (!editingPreset || !editName.trim() || checkedIds.size === 0) return

    onEdit({
      id: editingPreset.id, // same id, preserves identity
      name: editName.trim(),
      filters: editingPreset.filters.filter((f) => checkedIds.has(f.id)),
    })

    handleCloseEdit()
  }

  if (presets.length === 0) return null

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      {presets.map((preset) => (
        <Chip
          variant={selectedPresetId === preset.id ? "filled" : "outlined"}
          size="small"
          key={preset.id}
          label={preset.name}
          onClick={() => onApply(preset)}
          onDelete={() => onDelete(preset.id)}
          icon={
            <Edit
              fontSize="small"
              onClick={(e) => {
                e.stopPropagation() // prevent onClick (apply) from firing
                handleOpenEdit(preset)
              }}
            />
          }
        />
      ))}

      <Modal open={!!editingPreset} onClose={handleCloseEdit}>
        <Box sx={modalStyle}>
          <Typography variant="h6">Edit</Typography>

          <TextField
            label="Preset name"
            variant="outlined"
            size="small"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />

          <Divider />

          <Typography variant="body2" color="text.secondary">
            Choose which filters to include:
          </Typography>

          <FormGroup>
            {editingPreset?.filters.map((filter) => (
              <FormControlLabel
                key={filter.id}
                control={
                  <Checkbox
                    checked={checkedIds.has(filter.id)}
                    onChange={() => toggleCheck(filter.id)}
                  />
                }
                label={`${filter.id}: ${formatValue(filter.value)}`}
              />
            ))}
          </FormGroup>

          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button onClick={handleCloseEdit}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSaveEdit}
              disabled={!editName.trim() || checkedIds.size === 0}
            >
              Save
            </Button>
          </Box>
        </Box>
      </Modal>
    </Box>
  )
}
