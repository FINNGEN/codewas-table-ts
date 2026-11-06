import { Box, Stack, Typography } from "@mui/material"
import { evidenceDirectionColor } from "../utils/heatmapUtils"

const stops = (direction: "negative" | "positive" | "unsigned") =>
  Array.from({ length: 7 }, (_, index) => evidenceDirectionColor(index / 6, direction)).join(", ")

export default function EvidenceDirectionLegend() {
  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Typography variant="caption" sx={{ minWidth: 52 }}>Negative</Typography>
        <Box sx={{ flex: 1, height: 12, borderRadius: 0.5, background: `linear-gradient(to right, ${stops("negative")})` }} />
        <Typography variant="caption">stronger</Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, alignItems: "center" }}>
        <Typography variant="caption" sx={{ minWidth: 52 }}>Positive</Typography>
        <Box sx={{ flex: 1, height: 12, borderRadius: 0.5, background: `linear-gradient(to right, ${stops("positive")})` }} />
        <Typography variant="caption">stronger</Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, alignItems: "center" }}>
        <Typography variant="caption" sx={{ minWidth: 52 }}>Unsigned</Typography>
        <Box sx={{ flex: 1, height: 12, borderRadius: 0.5, background: `linear-gradient(to right, ${stops("unsigned")})` }} />
        <Typography variant="caption">stronger</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Hue = effect direction; intensity = statistical evidence. Categorical results are unsigned.
      </Typography>
    </Box>
  )
}
