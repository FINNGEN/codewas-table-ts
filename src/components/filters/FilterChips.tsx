import { useState } from "react"
import {
  Box,
  Chip,
  Typography,
  Modal,
  Button,
  TextField,
  FormGroup,
  Checkbox,
  FormControlLabel,
  Divider,
} from "@mui/material"
import { Clear, Save } from "@mui/icons-material"

export type ActiveFilter = {
  id: string
  label: string
  value: string
  onClear: () => void
  onEdit?: () => void
}

type FilterChipsProps = {
  filters: ActiveFilter[]
  onClearAll: () => void
  onSave: (name: string, includedIds: string[]) => void
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

export function FilterChips({ filters, onClearAll, onSave }: FilterChipsProps) {
  const [open, setOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  // When the modal opens, pre-check all active filters by default
  const handleOpen = () => {
    setCheckedIds(new Set(filters.map((f) => f.id)))
    setPresetName("")
    setOpen(true)
  }

  const handleClose = () => setOpen(false)

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = () => {
    if (!presetName.trim() || checkedIds.size === 0) return
    onSave(presetName.trim(), [...checkedIds])
    handleClose()
  }

  if (filters.length === 0) return null

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      {filters.map((filter) => (
        <Chip
          key={filter.id}
          label={`${filter.label}: ${filter.value}`}
          onClick={filter.onEdit}
          onDelete={filter.onClear}
          size="small"
          clickable={filter.onEdit != null}
        />
      ))}

      <Chip label="Clear" icon={<Clear />} variant="outlined" onClick={onClearAll} size="small" />
      <Chip label="Save " icon={<Save />} variant="outlined" onClick={handleOpen} size="small" />

      <Modal open={open} onClose={handleClose}>
        <Box sx={modalStyle}>
          <Typography variant="h6">Save filter preset</Typography>

          <TextField
            label="Preset name"
            variant="outlined"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            size="small"
            autoFocus
          />

          <Divider />

          <Typography variant="body2" color="text.secondary">
            Choose which filters to include:
          </Typography>

          <FormGroup>
            {filters.map((filter) => (
              <FormControlLabel
                key={filter.id}
                control={
                  <Checkbox
                    checked={checkedIds.has(filter.id)}
                    onChange={() => toggleCheck(filter.id)}
                  />
                }
                label={`${filter.label}: ${filter.value}`}
              />
            ))}
          </FormGroup>

          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!presetName.trim() || checkedIds.size === 0}
            >
              Save
            </Button>
          </Box>
        </Box>
      </Modal>
    </Box>
  )
}
