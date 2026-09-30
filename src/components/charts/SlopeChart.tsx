import * as THREE from "three"
import { Canvas } from "@react-three/fiber"

import { extent, scaleLinear, type ScaleLinear } from "d3"
import { useMemo, useState } from "react"

import { Box } from "@mui/material"
import { YAxis } from "./YAxis"

type SlopeChartData = {
  id: number
  start: number
  end: number
}

type SlopeChartProps = {
  data: SlopeChartData[]
  visibleDataIds: number[]
}
// WIP: props for the disabled AllLines component (see below).
/*
type AllLinesProps = {
  data: SlopeChartData[]
  visibleDataIds: number[]

  yScale: ScaleLinear<number, number, never>
  x1: number
  x2: number
}
*/

type RangePolygonsProps = {
  data: SlopeChartData[]
  yScale: ScaleLinear<number, number, never>
  x1: number
  x2: number
}

const CANVAS_SIZE = {
  width: 400,
  height: 250,
}

const ZOOM = 50
const worldWidth = CANVAS_SIZE.width / ZOOM
const worldHeight = CANVAS_SIZE.height / ZOOM

function makeQuadGeometry(
  x1: number,
  y1top: number,
  y1bot: number,
  x2: number,
  y2top: number,
  y2bot: number,
): THREE.ShapeGeometry {
  // Trace the four corners as a closed 2D shape (counter-clockwise)
  const shape = new THREE.Shape()
  shape.moveTo(x1, y1bot) // bottom-left
  shape.lineTo(x1, y1top) // top-left
  shape.lineTo(x2, y2top) // top-right
  shape.lineTo(x2, y2bot) // bottom-right
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

export function SlopeChart({ data, visibleDataIds }: SlopeChartProps) {
  console.log(data)
  console.log(visibleDataIds)

  const [hoveredIndex] = useState<number | null>(null)

  const allValues = data.map((d) => [d.start, d.end]).flat()
  const ext = extent(allValues) as [number, number]
  if (ext[0] === undefined) return null

  const sortedData = useMemo(() => [...data].sort((a, b) => +a.start - +b.start), [data])

  const yScale = useMemo(
    () =>
      scaleLinear()
        .domain(ext)
        .range([-worldHeight / 2, worldHeight / 2 - 0.3]),
    [worldHeight, ext],
  )

  const [x1, x2] = [-worldWidth / 2 + 1, worldWidth / 2 - 1]

  /* WIP: nearest-line hover detection - re-enable with onMouseMove on the canvas container below
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const rect = e.currentTarget?.getBoundingClientRect()
      const xRatio = (e.clientX - rect.left) / rect.width // 0->1 left to right
      const yRatio = (e.clientY - rect.top) / rect.height

      const worldY = (1 - yRatio) * worldHeight - worldHeight / 2

      let closestIndex = 0
      let closestDist = Infinity

      data.forEach((d, i) => {
        // Interpolate the line's Y at the mouse's X position
        const lineYAtMouseX = d.start + xRatio * (d.end - d.start)

        const dist = Math.abs(yScale(lineYAtMouseX) - worldY)
        if (dist < closestDist) {
          closestDist = dist
          closestIndex = i
        }
      })

      setHoveredIndex(closestIndex)
    },
    [data, yScale, worldHeight],
  )
  */

  return (
    <Box
      id="canvas-container"
      sx={{ width: CANVAS_SIZE.width, height: CANVAS_SIZE.height, position: "relative" }}
      // onMouseMove={handleMouseMove}
      // onMouseLeave={() => setHoveredIndex(null)}
    >
      <Canvas
        orthographic
        camera={{ zoom: ZOOM, position: [0, 0, 100] }}
        // frameloop="demand" // only renders when invalidated
        style={{ position: "absolute", inset: 0 }}
        onCreated={({ gl }) => {
          // Ensures context is properly re-initialized on HMR
          gl.setPixelRatio(window.devicePixelRatio)
        }}
      >
        <RangePolygons data={sortedData} yScale={yScale} x1={x1} x2={x2} />
        {/* <AllLines
          data={sortedData}
          visibleDataIds={visibleDataIds}
          yScale={yScale}
          x1={x1}
          x2={x2}
        /> */}
        <YAxis
          yScale={yScale}
          x={x1}
          worldWidth={worldWidth}
          domain={ext}
          tickCount={10}
          label="cases"
        />
        <YAxis
          yScale={yScale}
          x={x2}
          worldWidth={worldWidth}
          domain={ext}
          tickCount={10}
          label="controls"
        />
        {/* <HoveredLine data={sortedData} index={hoveredIndex} yScale={yScale} x1={x1} x2={x2} /> */}
      </Canvas>

      {hoveredIndex && <p>id: {data[hoveredIndex].id}</p>}
    </Box>
  )
}

/* WIP: GPU line rendering - currently disabled at the call site above
function AllLines({ data, visibleDataIds, yScale, x1, x2 }: AllLinesProps) {
  const { selectedGeo, unselectedGeo } = useMemo(() => {
    const selected = data.filter((d) => visibleDataIds.includes(d.id))
    const unselected = data.filter((d) => !visibleDataIds.includes(d.id))

    const buildGeo = (
      items: SlopeChartData[],
      color: string,
      index: number = 0,
    ): THREE.BufferGeometry => {
      const positions = new Float32Array(items.length * 6)
      const colors = new Float32Array(items.length * 6)
      const c = new THREE.Color(color)
      items.forEach((d, i) => {
        const o = i * 6
        positions[o] = x1
        positions[o + 1] = yScale(d.start)
        positions[o + 2] = index
        positions[o + 3] = x2
        positions[o + 4] = yScale(d.end)
        positions[o + 5] = index
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
        colors[o + 3] = c.r
        colors[o + 4] = c.g
        colors[o + 5] = c.b
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3))
      return geo
    }

    return {
      selectedGeo: buildGeo(selected, "red", 1),
      unselectedGeo: buildGeo(unselected, "blue"),
    }
  }, [data, visibleDataIds, x1, x2, yScale])

  return (
    <>
      <lineSegments geometry={unselectedGeo}>
        <lineBasicMaterial vertexColors opacity={0.1} transparent />
      </lineSegments>
      <lineSegments geometry={selectedGeo}>
        <lineBasicMaterial vertexColors opacity={1} />
      </lineSegments>
    </>
  )
}
*/

export function RangePolygons({ data, yScale, x1, x2 }: RangePolygonsProps) {
  const { casesGeo, controlsGeo } = useMemo(() => {
    if (data.length === 0) return { casesGeo: null, controlsGeo: null }

    // Cases polygon: anchored by min/max of `start`, follow those items to their `end`
    const maxStartItem = data.reduce((a, b) => (b.start > a.start ? b : a))
    const minStartItem = data.reduce((a, b) => (b.start < a.start ? b : a))

    // Controls polygon: anchored by min/max of `end`, follow those items back to their `start`
    const maxEndItem = data.reduce((a, b) => (b.end > a.end ? b : a))
    const minEndItem = data.reduce((a, b) => (b.end < a.end ? b : a))

    return {
      casesGeo: makeQuadGeometry(
        x1,
        yScale(maxStartItem.start),
        yScale(minStartItem.start),
        x2,
        yScale(maxStartItem.end),
        yScale(minStartItem.end),
      ),
      controlsGeo: makeQuadGeometry(
        x1,
        yScale(maxEndItem.start),
        yScale(minEndItem.start),
        x2,
        yScale(maxEndItem.end),
        yScale(minEndItem.end),
      ),
    }
  }, [data, yScale, x1, x2])

  if (!casesGeo || !controlsGeo) return null

  return (
    <>
      {/* Cases polygon - anchored on the left (cases axis) */}
      <mesh geometry={casesGeo}>
        <meshBasicMaterial color="red" opacity={0.3} transparent side={THREE.DoubleSide} />
      </mesh>

      {/* Controls polygon - anchored on the right (controls axis) */}
      <mesh geometry={controlsGeo}>
        <meshBasicMaterial color="blue" opacity={0.3} transparent side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}
