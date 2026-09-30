import { Box, Stack, Typography } from "@mui/material"
import { HEATMAP_PATTERNS, patternSwatchStyle } from "../utils/heatmapPatterns"

// Ordered key for the texture ramp: one swatch per level, weakest -> strongest.
export default function PatternLegend({
  label = "-log10(p)",
  swatchWidth = 26,
  swatchHeight = 16,
}: {
  label?: string
  swatchWidth?: number
  swatchHeight?: number
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary">
        {label} weaker
      </Typography>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        {HEATMAP_PATTERNS.map((_, level) => (
          <Box
            key={level}
            title={`Level ${level + 1} of ${HEATMAP_PATTERNS.length}`}
            style={patternSwatchStyle(level, swatchHeight)}
            sx={{
              width: swatchWidth,
              height: swatchHeight,
              border: "1px solid",
              borderColor: "divider",
              borderLeftWidth: level === 0 ? 1 : 0,
            }}
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        stronger
      </Typography>
    </Stack>
  )
}
