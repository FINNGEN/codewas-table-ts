import { Grid, Paper } from "@mui/material"
import type { ConceptRow } from "../../utils/types"
import { BarChart } from "@mui/x-charts"

export function CustomBarChart({ data }: { data: ConceptRow[] }) {
  return (
    <Grid size={{ xs: 12, md: 6 }}>
      <Paper sx={{ width: "100%", height: 400 }}>
        <BarChart
          series={[
            {
              data: data.map((d) => d.d_Binary[0][0].case),
              label: "case",
              type: "bar",
            },
            { data: data.map((d) => d.d_Binary[0][0].control), label: "control", type: "bar" },
          ]}
          xAxis={[
            {
              scaleType: "band",
              data: data.map((d) => d.conceptName.slice(0, 20) + "..."),
              height: 50,
              tickLabelPlacement: "middle",
              tickLabelStyle: { fontSize: 10, fontWeight: "bold" },
              label: "Case ID with value",
              labelStyle: { fontSize: 10, fontWeight: "bold" },
            },
          ]}
          yAxis={[
            {
              width: 75,
              tickLabelStyle: { fontSize: 10, fontWeight: "bold" },
              label: "Entries",
              labelStyle: { fontSize: 10, fontWeight: "bold" },
            },
          ]}
          grid={{ vertical: true }}
          borderRadius={4}
        />
      </Paper>
    </Grid>
  )
}
