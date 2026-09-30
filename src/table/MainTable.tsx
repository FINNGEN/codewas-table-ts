import { useMemo, useRef, useState } from "react"
import { MaterialReactTable, useMaterialReactTable } from "material-react-table"
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material"
import type { ConceptMetadata, ConceptTableProps } from "../utils/types"
import { FilterWrapper } from "../components/filters/FiltersWarpper"

import { countModeLabel, useColumns } from "./ColumnFactory"
import { TopToolbar } from "./TopToolbar"
import { Heatmap } from "../components/charts/Heatmap"
import { Scatter } from "../components/charts/Scatter"
import { Remove, Add } from "@mui/icons-material"

// ─── main table ───────────────────────────────────────────────────────────

export default function MainTable({ data, setData, pageView }: ConceptTableProps) {
  const tableContainerRef = useRef(null)
  const [countModeFilter, setCountModeFilter] = useState<"code" | "descendant" | "all">("all")

  const grouping = ["ancestorConceptIds"]
  const columnFilters = [
    {
      id: "casesControl",
      value: ["5", ""],
    },
    {
      id: "-log10Binary",
      value: ["5", ""],
    },
  ]

  const countModeOptions = useMemo(() => {
    const modes = new Set((data ?? []).map((row) => row.countMode).filter(Boolean) as string[])
    return Array.from(modes).sort()
  }, [data])

  const filteredData = useMemo(() => {
    if (!data) return []
    if (countModeFilter === "all") return data
    return data.filter((row) => row.countMode === countModeFilter)
  }, [countModeFilter, data])

  const formattedData = useMemo(
    () =>
      filteredData.map((d) => ({
        ...d,
        isStandard: !d.domainId.includes("Source:"),
      })),
    [filteredData],
  )

  const conceptsById = useMemo<Record<number, ConceptMetadata>>(() => {
    const concepts: Record<number, ConceptMetadata> = {}

    ;(formattedData ?? []).forEach((row) => {
      concepts[row.conceptId] = row
      ;(row.ancestorConcepts ?? []).forEach((ancestor) => {
        if (!ancestor?.conceptId) return
        concepts[ancestor.conceptId] = ancestor
      })
    })

    return concepts
  }, [formattedData])
  // const conceptsById = useMemo<Record<number, ConceptRow>>(
  //   () => Object.fromEntries((formattedData ?? []).map((row) => [row.conceptId, row])),
  //   [formattedData],
  // )

  // MRT_ColumnDef<ConceptRow> types each column to your data shape.
  // `accessorFn` lets you derive a display value from nested fields.
  const columns = useColumns(conceptsById)

  // Expanded rows: one row per ancestorConceptId
  const expandedRows = useMemo(() => {
    return filteredData.flatMap((row) =>
      (row.ancestorConceptIds ?? []).map((ancestorId) => ({
        ...row,
        ancestorConceptIds: [ancestorId],
      })),
    )
  }, [filteredData])

  const rootRows = useMemo(() => {
    if (!formattedData) return []

    const allDesc =
      countModeFilter === "code"
        ? formattedData
        : formattedData.filter((r) => r.countMode === "descendant")
    console.log("AD", allDesc)

    // IDs of concepts that exist in the dataset and appear as someone's ancestor
    const allConceptIds = new Set(allDesc.map((r) => r.conceptId))

    const ancestorIdsInDataset = new Set(
      allDesc.flatMap((r) => r.ancestorConceptIds ?? []).filter((id) => allConceptIds.has(id)), // O(1) lookup now
    )

    // A row is a root if none of its ancestors exist in the dataset
    return allDesc.filter((r) => !r.ancestorConceptIds?.some((id) => ancestorIdsInDataset.has(id)))
  }, [formattedData, countModeFilter])

  // TODO When data will have children
  /*
  const { rootRows, rowById } = useMemo(() => {
  if (!formattedData) return { rootRows: [], rowById: {} }

  const allDesc = countModeFilter === "code"
    ? formattedData
    : formattedData.filter((r) => r.countMode === "descendant")

  const rowById = Object.fromEntries(allDesc.map((r) => [r.conceptId, r]))
  const allChildIds = new Set(allDesc.flatMap((r) => r.childConceptIds ?? []))
  const rootRows = allDesc.filter((r) => !allChildIds.has(r.conceptId))

  return { rootRows, rowById }
}, [formattedData, countModeFilter])
*/

  console.log("rootRows", rootRows)
  const isGrouping = grouping.includes("ancestorConceptIds")

  // const tableData = useMemo(
  //   () => (isGrouping ? expandedRows : filteredData),
  //   [expandedRows, filteredData, isGrouping],
  // )

  const table = useMaterialReactTable({
    columns,
    data: rootRows,
    enableExpanding: true,
    // aggregationFns: { sumBinaryCount },
    state: {
      // grouping,
      columnVisibility: {
        conceptName: false,
        conceptId: false,
        domainId: false,
        ancestorConceptIds: false,
      },
    },
    getSubRows: (row) => expandedRows.filter((r) => r.ancestorConceptIds.includes(row.conceptId)),
    // getSubRows: (row) => (row.childConceptIds ?? []).map((id) => rowById[id]).filter(Boolean),
    layoutMode: "grid-no-grow",

    defaultColumn: {
      minSize: 20,
      size: 115, // starting point - override per column as needed
      maxSize: 400,
    },
    // ── expand ──
    // renderDetailPanel: ({ row }) => <ConceptDetailPanel row={row} />,
    // ── pagination ──
    enableColumnPinning: true,
    initialState: {
      columnFilters,
      sorting: [
        {
          id: "oddsRatioBinary", //sort by age by default on page load
          desc: true,
        },
      ],
      pagination: { pageSize: 20, pageIndex: 0 },
      columnPinning: { left: ["mrt-row-expand", "info"] },
      density: "compact",
    },
    // onGroupingChange: (updater) => {
    //   const newGrouping = typeof updater === "function" ? updater(grouping) : updater
    //   setGrouping(newGrouping)
    // },

    // ── filtering ──
    enableColumnFilters: true,
    enableGlobalFilter: true,
    // ── sorting ──
    enableSorting: true,

    // ── grouping ──
    enableGrouping: true,
    // ── misc ──
    enableStickyHeader: true,

    muiTableContainerProps: { sx: { maxHeight: "70vh" }, ref: tableContainerRef },
    renderTopToolbarCustomActions: ({ table }) => <TopToolbar table={table} setData={setData} />,

    // Apply to all header cells globally
    muiTableHeadCellProps: {
      sx: {
        flex: "0 0 auto",
      },
    },

    muiTableFooterCellProps: {
      sx: { flex: "0 0 auto" },
    },
    muiFilterTextFieldProps: {
      variant: "outlined",
      size: "small",
    },

    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        ...(row.getCanExpand() && {
          borderLeft: "3px solid",
          borderColor: "primary.light",
          fontWeight: "bold",
        }),
        ...(!row.getCanExpand() && {
          borderLeft: "3px solid",
          borderColor: "transparent", // keeps alignment consistent
        }),

        ...(row.depth === 1 && {
          borderLeft: "3px solid",
          borderColor: "primary.main",
        }),
        ...(row.depth > 1 && {
          borderLeft: "3px solid",
          borderColor: "divider",
        }),
      },
    }),
    displayColumnDefOptions: {
      "mrt-row-expand": {
        Cell: ({ row }) => {
          const isLastChild = () => {
            const parent = row.getParentRow()
            if (!parent) return false
            const siblings = parent.subRows ?? []
            return siblings[siblings.length - 1].id === row.id
          }

          return (
            <Box sx={{ display: "flex", alignItems: "center", position: "relative" }}>
              {/* vertical + horizontal connector lines */}
              {row.depth > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    left: `${(row.depth - 1) * 16 + 8}px`,
                    top: isLastChild() ? "50%" : 0,
                    bottom: isLastChild() ? "auto" : 0,
                    width: "1px",
                    backgroundColor: "divider",
                    height: isLastChild() ? "50%" : "100%",
                  }}
                />
              )}
              {row.depth > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    left: `${(row.depth - 1) * 16 + 8}px`,
                    top: "50%",
                    width: "8px",
                    height: "1px",
                    backgroundColor: "divider",
                  }}
                />
              )}

              <Box sx={{ paddingLeft: `${row.depth * 16}px` }}>
                {row.getCanExpand() ? (
                  <IconButton size="small" onClick={row.getToggleExpandedHandler()}>
                    {row.getIsExpanded() ? <Remove fontSize="small" /> : <Add fontSize="small" />}
                  </IconButton>
                ) : (
                  <Box sx={{ width: 28 }} />
                )}
              </Box>
            </Box>
          )
        },
        size: 50,
        header: "",
      },
    },
  })

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0 }}>
      {/* <Typography>{data.length} rows</Typography> */}
      {countModeOptions.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600 }}>
            Mode
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={countModeFilter}
            onChange={(_event, value) => {
              if (value) setCountModeFilter(value)
            }}
          >
            <ToggleButton value="all">All</ToggleButton>
            {countModeOptions.map((mode) => (
              <ToggleButton key={mode} value={mode}>
                {countModeLabel(mode)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}
      <FilterWrapper table={table} />
      {pageView === "charts" && (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Scatter data={table} />
          <Heatmap
            table={table}
            metricKey="pValue"
            tableContainerRef={tableContainerRef}
            isGrouping={isGrouping}
          />
        </Box>
      )}
      {pageView === "table" && (
        <Box sx={{ display: "flex", gap: 1 }}>
          <MaterialReactTable table={table} />
        </Box>
      )}
    </Box>
  )
}
