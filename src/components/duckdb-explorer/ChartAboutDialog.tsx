import { useState, type ReactNode } from "react"
import { Info } from "@mui/icons-material"
import { Box, Button, Modal, Stack, Typography } from "@mui/material"

export function ChartAboutDialog({ children, title }: { children: ReactNode; title: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} startIcon={<Info />} variant="outlined" size="small">
        About
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} aria-labelledby="chart-about-title">
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: { xs: "calc(100vw - 32px)", sm: 560 },
            maxHeight: "80vh",
            overflowY: "auto",
            bgcolor: "background.paper",
            boxShadow: 24,
            p: 3,
            borderRadius: 2,
          }}
        >
          <Typography id="chart-about-title" variant="h6" sx={{ mb: 2 }}>
            {title}
          </Typography>
          <Stack spacing={1.5} color="text.secondary">
            {children}
          </Stack>
        </Box>
      </Modal>
    </>
  )
}
