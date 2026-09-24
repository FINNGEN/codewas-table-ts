import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnFiltersState,
  type MRT_ExpandedState,
  type MRT_PaginationState,
  type MRT_SortingState,
  type MRT_VisibilityState,
} from "material-react-table"
import type { DuckDbDataSource, PageViewOptions } from "../../utils/types"
import {
  AI_CATEGORY_ALL,
  AI_CATEGORY_ANY,
  AI_PRIORITIZATION_TABLE,
  CHART_ROWS_LIMIT,
  DEFAULT_COLUMN_FILTERS,
  DISPLAY_ANALYSIS_TYPES,
} from "./constants"
import { ConceptDetailDialog } from "./ConceptDetailDialog"
import { DuckDbCharts } from "./DuckDbCharts"
import { DuckDbFilterBar } from "./DuckDbFilterBar"
import {
  attachChildrenToHierarchy,
  buildHierarchyIndex,
  getExpandedRowKeys,
  orderRowsByRowKeys,
  withEmptySubRows,
} from "./utils/hierarchyUtils"
import {
  buildAiCategoriesQuery,
  buildHeatmapQuery,
  buildHierarchyMetaQuery,
  buildPagedSummaryQuery,
  buildSummaryCountQuery,
  buildSummaryRowsByRowKeysQuery,
} from "./queryBuilders"
import { mapCohortInfoRow, mapHeatmapRow, mapHierarchyMetaRow, mapSummaryRow } from "./rowMappers"
import { buildColumns } from "./tableColumns"
import type {
  AiFilter,
  BlockMetricRow,
  ChartScope,
  CohortInfoIndex,
  ConceptSummaryRow,
  HierarchyIndex,
  TableMode,
} from "./types"
import DownloadMenu from "./DownloadMenu"
import { Search } from "@mui/icons-material"
import { CohortsInfoTable } from "./CohortsInfoTable"

// Order-independent deep comparison of two MRT column-filter states, used to detect whether the
// draft filters differ from the applied snapshot ("dirty" state).
function filtersEqual(a: MRT_ColumnFiltersState, b: MRT_ColumnFiltersState): boolean {
  if (a.length !== b.length) return false
  const normalize = (filters: MRT_ColumnFiltersState) =>
    [...filters].sort((x, y) => x.id.localeCompare(y.id))
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

export default function DuckDbExplorer({
  dataSource,
  pageView,
  onConceptStats,
}: {
  dataSource: DuckDbDataSource
  pageView: PageViewOptions
  onConceptStats?: (stats: { filtered: number; total: number }) => void
}) {
  const [countMode, setCountMode] = useState("all")
  const [selectedDomain, setSelectedDomain] = useState("all")
  const [searchText, setSearchText] = useState("")
  const [domains, setDomains] = useState<string[]>([])
  const [aiCategories, setAiCategories] = useState<string[]>([])
  const [selectedAiCategory, setSelectedAiCategory] = useState(AI_CATEGORY_ALL)
  const [cohortsInfo, setCohortsInfo] = useState<CohortInfoIndex>({})
  const [chartRows, setChartRows] = useState<ConceptSummaryRow[]>([])
  const [tableRows, setTableRows] = useState<ConceptSummaryRow[]>([])
  const [tableRowCount, setTableRowCount] = useState(0)
  const [totalRowCount, setTotalRowCount] = useState(0)
  const [hierarchyRows, setHierarchyRows] = useState<ConceptSummaryRow[]>([])
  const [hierarchyExpanded, setHierarchyExpanded] = useState<MRT_ExpandedState>({})
  const [hierarchyIndex, setHierarchyIndex] = useState<HierarchyIndex | null>(null)
  const [hierarchyLoadedParentRowKeys, setHierarchyLoadedParentRowKeys] = useState<string[]>([])
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null)
  const [selectedDetailRow, setSelectedDetailRow] = useState<ConceptSummaryRow | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartScope, setChartScope] = useState<ChartScope>("filtered")
  const [tableLoading, setTableLoading] = useState(false)
  const [hierarchyLoading, setHierarchyLoading] = useState(false)
  const [tableMode, setTableMode] = useState<TableMode>("flat")
  // Draft column filters drive the MRT inputs; the applied snapshot drives the SQL queries. Edits to
  // the inputs (and Search) are staged until the user applies them, to avoid a query per keystroke.
  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>(DEFAULT_COLUMN_FILTERS)
  const [appliedColumnFilters, setAppliedColumnFilters] =
    useState<MRT_ColumnFiltersState>(DEFAULT_COLUMN_FILTERS)
  const [appliedSearchText, setAppliedSearchText] = useState("")
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>({
    ancestorConceptIds: false,
    aiRationale: false,
  })
  const [sorting, setSorting] = useState<MRT_SortingState>([{ id: "binaryEffect", desc: true }])
  const [pagination, setPagination] = useState<MRT_PaginationState>({ pageIndex: 0, pageSize: 20 })
  const hierarchyLoadingParentRowKeysRef = useRef(new Set<string>())

  // The AI review tables are optional. `dataSource.tableCounts` is already the full main-schema
  // listing taken at load time, so presence is known synchronously during render — no probe query,
  // and no first pass that queries a shape the database does not have.
  const aiAvailable = useMemo(
    () => dataSource.tableCounts.some((table) => table.tableName === AI_PRIORITIZATION_TABLE),
    [dataSource],
  )
  // Bundled into one memo so the query effects below can depend on it by identity.
  const aiFilter = useMemo<AiFilter>(
    () => ({ enabled: aiAvailable, category: selectedAiCategory }),
    [aiAvailable, selectedAiCategory],
  )

  // Commit the staged column filters + search into the applied snapshot (button / Enter key).
  const applyFilters = useCallback(() => {
    setAppliedColumnFilters(columnFilters)
    setAppliedSearchText(searchText)
  }, [columnFilters, searchText])

  // Explicit single-click actions (chips, clear-all, presets) take effect immediately: they update
  // both the draft inputs and the applied snapshot in one step.
  const commitColumnFilters = useCallback((next: MRT_ColumnFiltersState) => {
    setColumnFilters(next)
    setAppliedColumnFilters(next)
  }, [])
  const commitSearchText = useCallback((next: string) => {
    setSearchText(next)
    setAppliedSearchText(next)
  }, [])

  // The rationale is long free text, so it only claims column width while the user is actually
  // working with the AI verdicts. Both updates happen here, in the one place the category can
  // change (selector, chip clear, preset), so they land in a single commit — and so hiding the
  // column by hand afterwards sticks until the category moves again.
  const changeAiCategory = useCallback(
    (next: string) => {
      // Presets are shared across every DuckDB file the user opens, so one saved against a database
      // with AI verdicts can be applied to one without them. There the category filters nothing, so
      // it is not adopted either — otherwise a chip would claim a filter that is not being applied.
      const resolved = aiAvailable ? next : AI_CATEGORY_ALL
      setSelectedAiCategory(resolved)
      setColumnVisibility((current) => ({
        ...current,
        aiRationale: resolved !== AI_CATEGORY_ALL,
      }))
    },
    [aiAvailable],
  )

  const filtersDirty = useMemo(
    () => searchText !== appliedSearchText || !filtersEqual(columnFilters, appliedColumnFilters),
    [searchText, appliedSearchText, columnFilters, appliedColumnFilters],
  )

  useEffect(() => {
    let active = true
    dataSource
      .runQuery(
        `
          SELECT DISTINCT domainId
          FROM analysisRef
          WHERE analysisType IN (${DISPLAY_ANALYSIS_TYPES.map((type) => `'${type}'`).join(", ")})
          ORDER BY domainId
        `,
      )
      .then((rows) => {
        if (!active) return
        setDomains(rows.map((row) => String(row.domainId)))
      })

    // cohortsInfo is keyed by cohort, not by analysis: it has no domainId/analysisType to filter on.
    // Read every row and index it by cohortId. `use` is quoted because it is a DuckDB statement
    // keyword, and aliased so the mapped object stays a valid TS identifier.
    dataSource
      .runQuery(
        `
          SELECT
            cohortId,
            cohortName,
            shortName,
            subsetParent,
            isSubset,
            subsetDefinitionId,
            cohortEntries,
            cohortSubjects,
            "use" AS cohortUse
          FROM cohortsInfo
          ORDER BY cohortId
        `,
      )
      .then((rows) => {
        if (!active) return
        const index: CohortInfoIndex = {}
        for (const row of rows) {
          const cohort = mapCohortInfoRow(row)
          index[cohort.cohortId] = cohort
        }
        setCohortsInfo(index)
      })

    if (aiAvailable) {
      dataSource
        .runQuery(buildAiCategoriesQuery())
        .then((rows) => {
          if (!active) return
          setAiCategories(rows.map((row) => String(row.aiCategory)))
        })
        .catch(() => {
          // Unreadable AI table: drop the selector rather than offer categories that would filter
          // every row away.
          if (active) setAiCategories([])
        })
    }

    return () => {
      active = false
    }
  }, [aiAvailable, dataSource])

  useEffect(() => {
    let active = true
    async function loadChartRows() {
      setChartLoading(true)
      setSummaryError(null)
      try {
        const rowsRaw = await dataSource.runQuery(
          buildHeatmapQuery(
            countMode,
            selectedDomain,
            appliedSearchText,
            chartScope === "filtered" ? appliedColumnFilters : [],
            aiFilter,
            CHART_ROWS_LIMIT,
          ),
        )
        if (!active) return
        setChartRows((rowsRaw as BlockMetricRow[]).map(mapHeatmapRow))
      } catch (error) {
        if (!active) return
        setSummaryError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active) {
          setChartLoading(false)
        }
      }
    }
    void loadChartRows()
    return () => {
      active = false
    }
  }, [
    chartScope,
    aiFilter,
    appliedColumnFilters,
    countMode,
    dataSource,
    appliedSearchText,
    selectedDomain,
  ])

  useEffect(() => {
    let active = true
    async function loadTableRows() {
      setTableLoading(true)
      try {
        const [rowsRaw, countRaw] = await Promise.all([
          dataSource.runQuery(
            buildPagedSummaryQuery(
              countMode,
              selectedDomain,
              appliedSearchText,
              appliedColumnFilters,
              sorting,
              pagination,
              aiFilter,
            ),
          ),
          dataSource.runQuery(
            buildSummaryCountQuery(
              countMode,
              selectedDomain,
              appliedSearchText,
              appliedColumnFilters,
              aiFilter,
            ),
          ),
        ])
        if (!active) return
        setTableRows((rowsRaw as BlockMetricRow[]).map(mapSummaryRow))
        setTableRowCount(
          Number((countRaw[0] as Record<string, unknown> | undefined)?.rowCount ?? 0),
        )
      } catch (error) {
        if (!active) return
        setSummaryError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active) {
          setTableLoading(false)
        }
      }
    }
    void loadTableRows()
    return () => {
      active = false
    }
  }, [
    aiFilter,
    appliedColumnFilters,
    countMode,
    dataSource,
    pagination,
    appliedSearchText,
    selectedDomain,
    sorting,
  ])

  // Unfiltered concept total for the current view (countMode/domain/search), so the footer can show
  // "filtered of total". Depends on the view selectors but NOT on columnFilters.
  useEffect(() => {
    let active = true
    dataSource
      .runQuery(buildSummaryCountQuery(countMode, selectedDomain, appliedSearchText, [], aiFilter))
      .then((countRaw) => {
        if (!active) return
        setTotalRowCount(
          Number((countRaw[0] as Record<string, unknown> | undefined)?.rowCount ?? 0),
        )
      })
      .catch(() => {
        // Total is non-critical; leave the previous value on failure.
      })
    return () => {
      active = false
    }
  }, [aiFilter, countMode, dataSource, appliedSearchText, selectedDomain])

  // Lift the table's row counts so the footer reflects exactly what the table shows.
  useEffect(() => {
    onConceptStats?.({ filtered: tableRowCount, total: totalRowCount })
  }, [onConceptStats, tableRowCount, totalRowCount])

  useEffect(() => {
    if (tableMode !== "hierarchy") return
    let active = true
    async function loadHierarchyRows() {
      setHierarchyLoading(true)
      try {
        const hierarchyCountMode = countMode === "code" ? "all" : countMode
        const metadataRowsRaw = await dataSource.runQuery(
          buildHierarchyMetaQuery(
            hierarchyCountMode,
            selectedDomain,
            appliedSearchText,
            appliedColumnFilters,
            aiFilter,
          ),
        )
        const hierarchyMetaRows = (metadataRowsRaw as BlockMetricRow[]).map(mapHierarchyMetaRow)
        const nextHierarchyIndex = buildHierarchyIndex(hierarchyMetaRows)
        const rootRowKeys = nextHierarchyIndex.rootRowKeys
        const rootRowsRaw =
          rootRowKeys.length > 0
            ? await dataSource.runQuery(
                buildSummaryRowsByRowKeysQuery(
                  hierarchyCountMode,
                  selectedDomain,
                  appliedSearchText,
                  rootRowKeys,
                  aiFilter,
                ),
              )
            : []
        if (!active) return
        setHierarchyIndex(nextHierarchyIndex)
        setHierarchyExpanded({})
        setHierarchyLoadedParentRowKeys([])
        hierarchyLoadingParentRowKeysRef.current.clear()
        setHierarchyRows(
          withEmptySubRows(
            orderRowsByRowKeys((rootRowsRaw as BlockMetricRow[]).map(mapSummaryRow), rootRowKeys),
          ),
        )
      } catch (error) {
        if (!active) return
        setSummaryError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active) {
          setHierarchyLoading(false)
        }
      }
    }
    void loadHierarchyRows()
    return () => {
      active = false
    }
  }, [
    aiFilter,
    appliedColumnFilters,
    countMode,
    dataSource,
    appliedSearchText,
    selectedDomain,
    tableMode,
  ])

  useEffect(() => {
    if (tableMode !== "hierarchy" || !hierarchyIndex) return
    const hierarchyCountMode = countMode === "code" ? "all" : countMode
    const activeHierarchyIndex = hierarchyIndex
    const expandedRowKeys = getExpandedRowKeys(hierarchyExpanded)
    const nextParentRowKeys = expandedRowKeys.filter((rowKey) => {
      const hasChildren =
        (activeHierarchyIndex.childRowKeysByParentRowKey.get(rowKey) ?? []).length > 0
      return (
        hasChildren &&
        !hierarchyLoadedParentRowKeys.includes(rowKey) &&
        !hierarchyLoadingParentRowKeysRef.current.has(rowKey)
      )
    })
    if (nextParentRowKeys.length === 0) return

    let active = true
    async function loadExpandedChildren() {
      nextParentRowKeys.forEach((rowKey) => hierarchyLoadingParentRowKeysRef.current.add(rowKey))
      try {
        const childRowKeys = Array.from(
          new Set(
            nextParentRowKeys.flatMap(
              (rowKey) => activeHierarchyIndex.childRowKeysByParentRowKey.get(rowKey) ?? [],
            ),
          ),
        )
        if (childRowKeys.length === 0 || !active) return
        const rowsRaw = await dataSource.runQuery(
          buildSummaryRowsByRowKeysQuery(
            hierarchyCountMode,
            selectedDomain,
            appliedSearchText,
            childRowKeys,
            aiFilter,
          ),
        )
        if (!active) return
        const orderedChildrenByParent = new Map<string, ConceptSummaryRow[]>()
        const fetchedRows = withEmptySubRows((rowsRaw as BlockMetricRow[]).map(mapSummaryRow))
        nextParentRowKeys.forEach((parentRowKey) => {
          const orderedRowKeys =
            activeHierarchyIndex.childRowKeysByParentRowKey.get(parentRowKey) ?? []
          orderedChildrenByParent.set(parentRowKey, orderRowsByRowKeys(fetchedRows, orderedRowKeys))
        })
        setHierarchyRows((currentRows) => {
          let nextRows = currentRows
          orderedChildrenByParent.forEach((children, parentRowKey) => {
            nextRows = attachChildrenToHierarchy(nextRows, parentRowKey, children)
          })
          return nextRows
        })
        setHierarchyLoadedParentRowKeys((current) => [
          ...current,
          ...nextParentRowKeys.filter((rowKey) => !current.includes(rowKey)),
        ])
      } catch (error) {
        if (!active) return
        setSummaryError(error instanceof Error ? error.message : String(error))
      } finally {
        nextParentRowKeys.forEach((rowKey) =>
          hierarchyLoadingParentRowKeysRef.current.delete(rowKey),
        )
      }
    }
    void loadExpandedChildren()
    return () => {
      active = false
      nextParentRowKeys.forEach((rowKey) => {
        hierarchyLoadingParentRowKeysRef.current.delete(rowKey)
      })
    }
  }, [
    aiFilter,
    countMode,
    dataSource,
    hierarchyExpanded,
    hierarchyIndex,
    hierarchyLoadedParentRowKeys,
    appliedSearchText,
    selectedDomain,
    tableMode,
  ])

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [aiFilter, appliedColumnFilters, countMode, appliedSearchText, selectedDomain])

  const columns = useMemo(() => buildColumns(aiAvailable), [aiAvailable])

  const table = useMaterialReactTable({
    columns,
    data: tableMode === "hierarchy" ? hierarchyRows : tableRows,
    // enableSorting: false,

    enableColumnPinning: true,
    enableColumnFilters: true,
    enablePagination: true,
    enableBottomToolbar: true,
    enableStickyHeader: true,
    enableStickyFooter: true,
    enableColumnActions: false,
    enableColumnOrdering: false,
    // MRT's own global search is dead weight here: manualFiltering means MRT never filters client
    // side, and nothing wires onGlobalFilterChange into the SQL, so typing in it did nothing. The
    // toolbar's Search field below is the real one. Dropping it also removes an icon button.
    enableGlobalFilter: false,
    // Unlike the bottom toolbar, this one's inner row is in flow — MRT switches it to
    // position: relative as soon as renderTopToolbarCustomActions is set — so the toolbar auto-sizes
    // to its content and minHeight can safely go to 0.
    muiTopToolbarProps: {
      sx: {
        minHeight: 0,
        "& > div:last-of-type": { gap: 1, p: 0.5 },
        "& .MuiIconButton-root": { p: 0.5 },
        "& .MuiIconButton-root .MuiSvgIcon-root": { fontSize: "1.15rem" },
      },
    },
    // Fill the flex parent and keep the header/toolbars fixed while the rows scroll inside.
    muiTablePaperProps: {
      sx: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
    },
    muiTableContainerProps: {
      sx: { flex: 1, minHeight: 0, overflow: "auto" },
    },
    // Compact pagination: drop the first/last jump buttons (prev/next plus the row counter cover it)
    // and offer only page sizes this table realistically uses.
    muiPaginationProps: {
      showFirstButton: false,
      showLastButton: false,
      rowsPerPageOptions: [20, 50, 100],
    },
    // The bottom toolbar reserves minHeight: 3.5rem and the pagination row adds 12px of its own
    // vertical padding, which is most of the strip's height. Both are trimmed here; the selectors
    // target MRT's own stable class names.
    //
    // minHeight cannot go to 0: MRT positions the pagination wrapper absolutely (right: 0, top: 0),
    // so it contributes no height and the toolbar would collapse onto its only in-flow child — an
    // empty <span/> — leaving the pagination hanging past the bottom edge, behind the footer. This
    // floor has to stay >= the pagination's own height (~29px measured with the font sizes below).
    muiBottomToolbarProps: {
      sx: {
        minHeight: "2rem",
        "& .MuiTablePagination-root": { gap: 1, px: 1, py: 0.25 },
        "& .MuiInputLabel-root, & .MuiTablePagination-root .MuiTypography-root": {
          fontSize: "0.7rem",
        },
        "& .MuiSelect-select": { fontSize: "0.7rem", py: 0 },
        "& .MuiIconButton-root": { p: 0.25 },
      },
    },
    enableExpanding: tableMode === "hierarchy",
    // Always treat filtering as manual: the rows we hand MRT are already filtered by SQL (the applied
    // snapshot). Client-side filtering would re-hide rows against the unapplied draft filters and
    // break the deferred-apply model in hierarchy mode.
    manualFiltering: true,
    manualPagination: tableMode === "flat",
    manualSorting: tableMode === "flat",
    onColumnFiltersChange: setColumnFilters,
    // Read by NumericFilterBuilder, whose popover has its own Apply button / Enter key.
    meta: { applyFilters },
    muiFilterTextFieldProps: {
      onKeyDown: (event) => {
        if (event.key === "Enter") applyFilters()
      },
    },
    onColumnVisibilityChange: setColumnVisibility,
    onExpandedChange: setHierarchyExpanded,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    initialState: {
      sorting: [{ id: "binaryEffect", desc: true }],
      pagination: { pageSize: 20, pageIndex: 0 },
      density: "compact",
      // Pinning state holds *leaf* column ids only — TanStack matches them against each column's
      // leaves, so the "info" group id would never resolve. Its two leaves have to be named instead.
      columnPinning: { left: ["mrt-row-expand", "conceptInfo", "ancestorConceptIds", "info"] },
      showColumnFilters: false,
    },
    rowCount: tableMode === "flat" ? tableRowCount : undefined,
    state: {
      isLoading: tableMode === "hierarchy" ? hierarchyLoading : tableLoading,
      columnFilters,
      columnVisibility,
      expanded: hierarchyExpanded,
      pagination,
      sorting,
    },
    getRowCanExpand: (row) =>
      tableMode === "hierarchy" &&
      Boolean(hierarchyIndex?.childRowKeysByParentRowKey.get(row.original.rowKey)?.length),
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.rowKey,
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        setFocusedRowKey(row.original.rowKey)
        setSelectedDetailRow(row.original)
      },
      sx: {
        cursor: "pointer",
        backgroundColor:
          focusedRowKey === row.original.rowKey
            ? "action.selected"
            : tableMode === "hierarchy" && row.depth > 0
              ? alpha("#1976d2", Math.min(0.035 + row.depth * 0.025, 0.12))
              : undefined,
        // No `position` here: MRT already gives body cells `position: relative`, and a pinned cell
        // gets `sticky` instead. A rule at this level (`.row-class td:first-of-type`) outranks the
        // cell's own class, so re-declaring `relative` would un-stick the pinned first column while
        // leaving the header — a <th>, untouched by this row sx — stuck. Either value still anchors
        // the ::before depth bar below.
        "& td:first-of-type::before":
          tableMode === "hierarchy" && row.depth > 0
            ? {
                content: '""',
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(4 + row.depth * 2, 10)}px`,
                backgroundColor: alpha("#1976d2", Math.min(0.15 + row.depth * 0.08, 0.42)),
              }
            : undefined,
      },
    }),
    renderTopToolbarCustomActions: () => (
      <Stack
        direction="row"
        spacing={2}
        sx={{
          // 4px, not the 8px this had: the outlined Selects' floating labels sit ~5px above their
          // input box and the toolbar clips overflow, so dropping this to 0 shears the label text off.
          // 4px here + the toolbar's own 4px padding clears them.
          my: 0.5,
          flexWrap: "wrap",
          placeContent: "space-between",
          alignContent: "center",
          overflow: "visible",
        }}
      >
        <Stack direction="row" spacing={2}>
          <FormControl sx={{ minWidth: 120 }} size="small">
            <InputLabel id="table-mode-label">Table View</InputLabel>
            <Select
              labelId="table-mode-label"
              value={tableMode}
              label="Table View"
              onChange={(event) => {
                const nextMode = event.target.value as TableMode
                setTableMode(nextMode)
                if (nextMode === "hierarchy" && countMode === "code") {
                  setCountMode("all")
                }
              }}
            >
              <MenuItem value="flat">Flat</MenuItem>
              <MenuItem value="hierarchy">Hierarchy</MenuItem>
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 130 }} size="small">
            <InputLabel id="count-mode-label">Count Mode</InputLabel>
            <Select
              labelId="count-mode-label"
              value={countMode}
              label="Count Mode"
              onChange={(event) => setCountMode(event.target.value)}
              disabled={tableMode === "hierarchy"}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="code">Exact code</MenuItem>
              <MenuItem value="descendant">All descendants</MenuItem>
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 130 }} size="small">
            <InputLabel id="domain-label">Domain</InputLabel>
            <Select
              labelId="domain-label"
              value={selectedDomain}
              label="Domain"
              onChange={(event) => setSelectedDomain(event.target.value)}
            >
              <MenuItem value="all">All domains</MenuItem>
              {domains.map((domain) => (
                <MenuItem key={domain} value={domain}>
                  {domain}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {aiAvailable && aiCategories.length > 0 && (
            <FormControl sx={{ minWidth: 150 }} size="small">
              <InputLabel id="ai-category-label">AI Category</InputLabel>
              <Select
                labelId="ai-category-label"
                value={selectedAiCategory}
                label="AI Category"
                onChange={(event) => changeAiCategory(event.target.value)}
              >
                <MenuItem value={AI_CATEGORY_ALL}>All rows</MenuItem>
                <MenuItem value={AI_CATEGORY_ANY}>Any AI category</MenuItem>
                {aiCategories.map((category) => (
                  <MenuItem key={category} value={category}>
                    {category}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <TextField
            label={
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                <Search sx={{ fontSize: 16 }} />
                Search concept/code/id
              </Box>
            }
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilters()
            }}
            sx={{ minWidth: 220 }}
            size="small"
          />
        </Stack>

        <DownloadMenu {...downloadMenuProps} />
      </Stack>
    ),
  })

  function focusRow(rowKey: string) {
    setFocusedRowKey(rowKey)
    // Stay on the charts view we came from; the concept dialog opens over it. Show the lean chart row
    // immediately, then upgrade to the full row so the dialog has complete stats.
    const fallbackRow = chartRows.find((row) => row.rowKey === rowKey) ?? null
    setSelectedDetailRow(fallbackRow)
    void dataSource
      .runQuery(
        buildSummaryRowsByRowKeysQuery(
          countMode,
          selectedDomain,
          appliedSearchText,
          [rowKey],
          aiFilter,
        ),
      )
      .then((rowsRaw) => {
        const full = (rowsRaw as BlockMetricRow[]).map(mapSummaryRow)[0]
        if (full) setSelectedDetailRow(full)
      })
      .catch(() => {
        // Keep the lean fallback row on failure.
      })
  }

  const downloadMenuProps = {
    dataSource,
    countMode,
    selectedDomain,
    searchText: appliedSearchText,
    columnFilters: appliedColumnFilters,
    aiFilter,
    exportLoading,
    setExportLoading,
  }

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            // backgroundColor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
            fontSize: 12,
          }}
        >
          {cohortsInfo && <CohortsInfoTable cohortsInfo={cohortsInfo} />}
          <Divider orientation="vertical" flexItem />
          <DuckDbFilterBar
            table={table}
            appliedColumnFilters={appliedColumnFilters}
            commitColumnFilters={commitColumnFilters}
            countMode={countMode}
            setCountMode={setCountMode}
            selectedDomain={selectedDomain}
            setSelectedDomain={setSelectedDomain}
            selectedAiCategory={selectedAiCategory}
            setSelectedAiCategory={changeAiCategory}
            appliedSearchText={appliedSearchText}
            commitSearchText={commitSearchText}
            isDirty={filtersDirty}
            onApply={applyFilters}
            rowCount={tableRowCount}
          />
        </Stack>
        {(tableLoading || chartLoading || hierarchyLoading || exportLoading) && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 2,
              color: "text.secondary",
            }}
          >
            <CircularProgress size={18} />
            <Typography variant="body2">
              {exportLoading
                ? "Preparing download..."
                : `Loading ${pageView === "charts" ? "chart" : tableMode === "hierarchy" ? "hierarchy" : "table"} results...`}
            </Typography>
          </Box>
        )}
        {summaryError && <Alert severity="error">{summaryError}</Alert>}
        {/* Fills the remaining height; the table scrolls inside it, charts scroll the box. */}
        <Box
          sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}
        >
          {pageView === "charts" ? (
            <DuckDbCharts
              rows={chartRows}
              chartLoading={chartLoading}
              chartScope={chartScope}
              setChartScope={setChartScope}
              onSelectConcept={focusRow}
            />
          ) : (
            <MaterialReactTable table={table} />
          )}
        </Box>
      </Box>
      <ConceptDetailDialog row={selectedDetailRow} onClose={() => setSelectedDetailRow(null)} />
    </Stack>
  )
}
