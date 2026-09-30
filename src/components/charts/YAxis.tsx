import { useMemo } from "react"
import { Line, Text } from "@react-three/drei"
import type { ScaleLinear } from "d3-scale"

type yAxisProps = {
  yScale: ScaleLinear<number, number, never>
  x: number
  worldWidth: number
  domain: [number, number]
  tickCount: number
  label: string
}

export function YAxis({ yScale, x, domain, tickCount = 8, label }: yAxisProps) {
  const ticks = useMemo(() => {
    // d3's scale .ticks() gives you "nice" round values in the domain
    return yScale.ticks(tickCount)
  }, [yScale, tickCount])

  const [yBottom, yTop] = [yScale(domain[0]), yScale(domain[1])]

  return (
    <group position={[0, 0, 1]}>
      {/* The vertical axis line */}
      <Line
        points={[
          [x, yBottom, 0],
          [x, yTop, 0],
        ]}
        color="black"
        lineWidth={1}
      />

      {ticks.map((value) => {
        const y = yScale(value)
        const TICK_LENGTH = 0.07
        const isLeft = x < 0 // controls which side the tick/label goes

        return (
          <group key={value} position={[0, y, 0]}>
            {/* Tick mark */}
            <Line
              points={[
                [x - TICK_LENGTH, 0, 0],
                [x + TICK_LENGTH, 0, 0],
              ]}
              color="black"
              lineWidth={1}
            />
            {/* Optional: faint grid line across the chart */}
            {/* <Line
              points={[
                [-worldWidth / 2 + 0.1, 0, 0],
                [worldWidth / 2 - 0.1, 0, 0],
              ]}
              color="#e0e0e0"
              lineWidth={0.5}
            /> */}
            {/* Tick label - nudge it to the outer side */}
            <Text
              position={[isLeft ? x - 0.4 : x + 0.4, 0, 0]}
              color="black"
              fontSize={0.18}
              anchorX={isLeft ? "right" : "left"}
              anchorY="middle"
            >
              {value.toLocaleString()}
            </Text>
          </group>
        )
      })}

      {/* Axis label */}
      {label && (
        <Text position={[x, yTop + 0.2, 0]} color="black" fontSize={0.2} anchorX="center">
          {label}
        </Text>
      )}
    </group>
  )
}
