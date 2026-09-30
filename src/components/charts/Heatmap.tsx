import { Canvas, useFrame, useThree } from "@react-three/fiber"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"

import type { ConceptRow } from "../../utils/types"
import { scaleSequential, type ScaleSequential } from "d3-scale"
import { interpolateRdYlBu } from "d3-scale-chromatic"
import { MeshBasicMaterial, OrthographicCamera } from "three"
import type { MRT_Row, MRT_TableInstance } from "material-react-table"

import { Typography } from "@mui/material"

type HeatmapProps = {
  table: MRT_TableInstance<ConceptRow>
  metricKey: string
  tableContainerRef: RefObject<HTMLDivElement | null>
  isGrouping: boolean
}
type HeatmapCellsProps = {
  table: MRT_TableInstance<ConceptRow>
  columns: string[]
  metricKey: string
  width: number
  height: number
  colorScale: ScaleSequential<string, never>
  setHoveredRow: Dispatch<SetStateAction<MRT_Row<ConceptRow> | null>>
  hoveredRow: MRT_Row<ConceptRow> | null
}
type OverlayProps = {
  isHovered: boolean
  width: number
  cellH: number
  onEnter: () => void
  onLeave: () => void
}

type CameraProps = {
  width: number
  height: number
}

const PADDING = 0

const columns = [
  "-log10Binary",
  "-log10Count",
  "-log10Age",
  "-log10Days",
  "-log10Continuous",
  "-log10Category",
]

function HoverOverlay({ isHovered, width, cellH, onEnter, onLeave }: OverlayProps) {
  const matRef = useRef<MeshBasicMaterial>(null)

  useFrame((_, delta) => {
    if (!matRef.current) return
    const target = isHovered ? 0.2 : 0
    matRef.current.opacity += (target - matRef.current.opacity) * Math.min(delta * 10, 1)
  })

  return (
    <mesh position={[0, 0, 1]} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <planeGeometry args={[width, cellH]} />
      <meshBasicMaterial ref={matRef} transparent opacity={0} color="black" />
    </mesh>
  )
}
function HeatmapCells({
  table,
  columns,
  width,
  height,
  colorScale,
  setHoveredRow,
  hoveredRow,
}: HeatmapCellsProps) {
  const allRows = table.getSortedRowModel().flatRows.filter((r) => !r.getIsGrouped())
  const pageRows = table.getPaginationRowModel().flatRows

  const getRowIds = (rows: MRT_Row<ConceptRow>[]): string[] =>
    rows.flatMap((r) => (r.subRows?.length ? getRowIds(r.subRows) : [r.id]))

  const pageRowIds = new Set(getRowIds(pageRows))

  const cols = columns.length
  const cellW = width / cols
  const cellH = height / allRows.length

  const offsetX = -width / 2 + cellW / 2
  const offsetY = height / 2 - cellH / 2

  const heatmapOffsetX = offsetX
  // const heatmapOffsetX = offsetX + labelWidth / 2 // shift cells right to make room

  return (
    <>
      {allRows.map((row, rowIdx) => {
        const y = offsetY - rowIdx * cellH
        const opacity = pageRowIds.has(row.id) ? 1 : 0.3
        // const label = row.getValue<string>("conceptName") // 👈 change to your id/name column key

        const isHovered = row?.id === hoveredRow?.id
        return (
          <group key={row.id} position={[0, y, 0]}>
            <HoverOverlay
              isHovered={isHovered}
              width={width}
              cellH={cellH}
              onEnter={() => setHoveredRow(row as MRT_Row<ConceptRow>)}
              onLeave={() => setHoveredRow(null)}
            />
            {/* Row label on the left */}
            {/* <Text
              position={[-width / 2 + labelWidth / 2, 0, 0]}
              fontSize={cellH * 0.5}
              maxWidth={labelWidth - 4}
              anchorX="center"
              anchorY="middle"
              color={1}
              clipRect={[-labelWidth / 2, -cellH / 2, labelWidth / 2, cellH / 2]}
            >
              {label}
            </Text> */}

            {/* Heatmap cells */}
            {columns.map((col, colIdx) => {
              const raw = row.getValue<number>(col)
              const color = (() => {
                if (raw == null) return "rgb(184, 184, 184)"
                if (raw === Infinity) return "rgb(255, 0, 0)"
                return colorScale(Math.pow(10, -raw))
              })()

              const x = heatmapOffsetX + colIdx * cellW

              return (
                <mesh key={col} position={[x, 0, 0]}>
                  {" "}
                  {/* y=0, group handles it */}
                  <planeGeometry args={[cellW - PADDING, cellH - PADDING]} />
                  <meshBasicMaterial color={color} opacity={opacity} transparent />
                </mesh>
              )
            })}
          </group>
        )
      })}
    </>
  )
}

function OrthoCamera({ width, height }: CameraProps) {
  const camera = useThree((state) => state.camera) as OrthographicCamera

  useEffect(() => {
    // Set orthographic camera to match canvas pixel dimensions exactly
    // so 1 unit = 1 pixel
    camera.left = -width / 2
    camera.right = width / 2
    camera.top = height / 2
    camera.bottom = -height / 2
    camera.near = -100
    camera.far = 100
    camera.position.set(0, 0, 10)
    camera.updateProjectionMatrix()
  }, [camera, width, height])

  return null
}

export function Heatmap({ table, metricKey = "pValue" }: HeatmapProps) {
  const [canvasSize] = useState({ width: 300, height: 500 })
  const [hoveredRow, setHoveredRow] = useState<MRT_Row<ConceptRow> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Replace pValueToColor with a d3 scale
  const colorScale = useMemo(
    () => scaleSequential().domain([1, 0]).interpolator(interpolateRdYlBu),
    [],
  ) // Red=low(significant) -> Blue=high

  return (
    <div ref={wrapperRef} style={{ width: canvasSize.width, height: canvasSize.height || 400 }}>
      <Typography sx={{ minHeight: 50 }}>
        {hoveredRow?.getValue("conceptName") ?? "pValues"}
      </Typography>
      {canvasSize.width > 0 && canvasSize.height > 0 && (
        <Canvas
          orthographic
          camera={{ zoom: 1, position: [0, 0, 10] }}
          style={{ width: "100%", height: "100%" }}
          gl={{ antialias: true }}
        >
          <OrthoCamera width={canvasSize.width} height={canvasSize.height} />
          <HeatmapCells
            table={table}
            columns={columns}
            metricKey={metricKey}
            width={canvasSize.width}
            height={canvasSize.height}
            colorScale={colorScale}
            setHoveredRow={setHoveredRow}
            hoveredRow={hoveredRow}
          />
        </Canvas>
      )}
    </div>
  )
}
