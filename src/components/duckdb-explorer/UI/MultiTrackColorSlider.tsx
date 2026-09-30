import { Box, Slider } from "@mui/material"
import { styled } from "@mui/material/styles"
import type { CSSProperties } from "react"

const RAIL_HEIGHT = 8

// N thumbs -> N+1 buckets, so colors.length must be values.length + 1.
function buildGradient(values: number[], colors: string[], min: number, max: number) {
  const range = max - min || 1
  const sorted = [...values].sort((a, b) => a - b)
  const pcts = sorted.map((v) => ((v - min) / range) * 100)

  const stops: string[] = []
  let prev = 0
  pcts.forEach((p, i) => {
    stops.push(`${colors[i]} ${prev}%`, `${colors[i]} ${p}%`) // hard stop = crisp edge
    prev = p
  })
  stops.push(`${colors[sorted.length]} ${prev}%`, `${colors[sorted.length]} 100%`)

  return `linear-gradient(to right, ${stops.join(", ")})`
}

const ColorScaleSlider = styled(Slider, {
  shouldForwardProp: (prop) => prop !== "gradient" && prop !== "railHeight",
})<{ gradient: string; railHeight: number }>(({ gradient, railHeight }) => ({
  height: railHeight,
  padding: "13px 0",
  "& .MuiSlider-rail": {
    // Transparent when segments are drawn behind the slider (see `segmentStyles`).
    opacity: gradient === "none" ? 0 : 1, // MUI dims the rail by default
    background: gradient,
    borderRadius: 100,
  },
  "& .MuiSlider-thumb": {
    height: 10,
    width: 10,
    borderRadius: 100,
    backgroundColor: "#fff",
    border: "0px solid currentColor",
  },
}))

// Controlled multi-thumb slider whose rail renders hard-stop buckets. The thumbs are the bucket
// breakpoints (value units); `colors` must have one more entry than `value` (N thumbs -> N+1 buckets).
// Pass `segmentStyles` (same length as `colors`) to render each bucket as a CSS background - e.g. the
// heatmap's texture swatches - instead of a flat color; the rail then mirrors what the cells look like.
export default function MultiTrackColorSlider({
  value,
  onChange,
  colors,
  segmentStyles,
  segmentHeight = 16,
  min = 0,
  max,
  marks,
}: {
  value: number[]
  onChange: (value: number[]) => void
  colors: string[]
  segmentStyles?: CSSProperties[] | null
  // Rail height in segmented mode - textures need more room than a flat color to read. The caller
  // passes the same value to whatever built `segmentStyles`, so the tiles divide the rail evenly.
  segmentHeight?: number
  min?: number
  max: number
  marks?: { value: number; label: string }[]
}) {
  const segmented = segmentStyles != null && segmentStyles.length > 0
  const gradient = segmented ? "none" : buildGradient(value, colors, min, max)
  const railHeight = segmented ? segmentHeight : RAIL_HEIGHT

  // Bucket widths as percentages of the rail, from the sorted breakpoints.
  const range = max - min || 1
  const stops = [...value]
    .sort((a, b) => a - b)
    .map((breakpoint) => ((breakpoint - min) / range) * 100)
  const widths = [...stops, 100].map((stop, index) =>
    Math.max(0, stop - (index === 0 ? 0 : stops[index - 1])),
  )

  const slider = (
    <ColorScaleSlider
      gradient={gradient}
      railHeight={railHeight}
      value={value}
      onChange={(_event, next) => onChange(next as number[])}
      min={min}
      max={max}
      track={false} // hide MUI's single track; the rail does the work
      disableSwap // thumbs can't cross - keeps the buckets ordered
      valueLabelDisplay="auto"
      valueLabelFormat={(v: number) => v.toFixed(1)}
      marks={marks}
    />
  )

  if (!segmented) return slider

  return (
    <Box sx={{ position: "relative" }}>
      {/* Drawn behind the slider, aligned to the rail MUI would have painted. */}
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          height: railHeight,
          display: "flex",
          overflow: "hidden",
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          pointerEvents: "none",
        }}
      >
        {widths.map((width, index) => (
          <Box
            key={index}
            style={{ width: `${width}%`, ...(segmentStyles?.[index] ?? {}) }}
            sx={{ flexShrink: 0 }}
          />
        ))}
      </Box>
      {slider}
    </Box>
  )
}
