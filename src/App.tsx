// App.tsx - wire up the table with your JSON data
import { ThemeProvider, CssBaseline, Alert, Box } from "@mui/material"
import { appTheme } from "./theme"

import { Footer } from "./components/Footer"
import InputFileUpload from "./components/FileUpload"
import DuckDbExplorer from "./components/duckdb-explorer"

import MainTable from "./table/MainTable"
import { ClipboardProvider } from "./components/duckdb-explorer/context/ClipboardContext"
import { useDataSource } from "./hooks/useDataSource"
import { useState } from "react"
import type { PageViewOptions } from "./utils/types"

export default function App() {
  const { dataSource, setDataSource, loading, error, filePath } = useDataSource()
  const [pageView, setPageView] = useState<PageViewOptions>("table")
  const [conceptStats, setConceptStats] = useState<{ filtered: number; total: number } | null>(null)

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <ClipboardProvider>
        <Box
          id="main"
          component={"main"}
          sx={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minHeight: 0,
            overflow: "hidden",
            px: 0,
          }}
        >
          {loading && <Alert severity="info">Loading data from URL...</Alert>}
          {error && <Alert severity="error">Error: {error}</Alert>}
          {!dataSource ? (
            <InputFileUpload setDataSource={setDataSource} />
          ) : dataSource.kind === "duckdb" ? (
            <DuckDbExplorer
              dataSource={dataSource}
              pageView={pageView}
              setPageView={setPageView}
              onConceptStats={setConceptStats}
            />
          ) : (
            <MainTable
              data={dataSource.rows}
              setData={(updater) => {
                setDataSource((current) => {
                  if (!current || current.kind !== "json") {
                    return current
                  }

                  const nextRows = typeof updater === "function" ? updater(current.rows) : updater
                  return nextRows ? { kind: "json", rows: nextRows } : null
                })
              }}
              pageView={pageView}
            />
          )}
        </Box>
        <Footer
          text={filePath}
          dataSource={dataSource}
          conceptStats={conceptStats}
          pageView={pageView}
          setPageView={setPageView}
        />
      </ClipboardProvider>
    </ThemeProvider>
  )
}
