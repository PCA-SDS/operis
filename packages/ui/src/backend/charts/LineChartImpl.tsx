"use client"

import * as React from 'react'
import {
  LineChart as RechartsLineChart,
  AreaChart as RechartsAreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { LineChartProps } from './LineChart'

type ImplProps = Pick<
  LineChartProps,
  | 'data'
  | 'index'
  | 'categories'
  | 'colors'
  | 'showArea'
  | 'valueFormatter'
  | 'showLegend'
  | 'showGridLines'
  | 'curveType'
  | 'connectNulls'
  | 'categoryLabels'
> & {
  valueFormatter: (value: number) => string
}

const CHART_MARGIN = { top: 5, right: 10, left: 10, bottom: 5 }
const AXIS_TICK = { fontSize: 12 }
const TOOLTIP_CURSOR = { stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }
const ACTIVE_DOT = { r: 4, strokeWidth: 0 }
const LEGEND_LABEL_STYLE: React.CSSProperties = { color: 'hsl(var(--muted-foreground))', fontSize: '12px' }

function renderLegendLabel(value: React.ReactNode): React.ReactNode {
  return <span style={LEGEND_LABEL_STYLE}>{value}</span>
}

function LineChartImpl({
  data,
  index,
  categories,
  colors,
  showArea = false,
  valueFormatter,
  showLegend = true,
  showGridLines = true,
  curveType = 'monotone',
  connectNulls = true,
  categoryLabels,
}: ImplProps) {
  const getLineColor = React.useCallback(
    (idx: number): string => resolveChartColor(colors?.[idx], idx),
    [colors],
  )
  const ChartComponent = showArea ? RechartsAreaChart : RechartsLineChart

  const tooltipContent = React.useMemo(
    () => <ChartTooltipContent valueFormatter={valueFormatter} categoryLabels={categoryLabels} />,
    [valueFormatter, categoryLabels],
  )

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ChartComponent
        data={data}
        margin={CHART_MARGIN}
      >
        {showGridLines && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
          />
        )}
        <XAxis
          dataKey={index}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={valueFormatter}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          content={tooltipContent}
          cursor={TOOLTIP_CURSOR}
        />
        {showLegend && categories.length > 1 && (
          <Legend
            verticalAlign="top"
            height={36}
            formatter={renderLegendLabel}
          />
        )}
        {showArea
          ? categories.map((category, idx) => (
              <Area
                key={category}
                type={curveType}
                dataKey={category}
                stroke={getLineColor(idx)}
                fill={getLineColor(idx)}
                fillOpacity={0.2}
                strokeWidth={2}
                connectNulls={connectNulls}
                dot={false}
                activeDot={ACTIVE_DOT}
              />
            ))
          : categories.map((category, idx) => (
              <Line
                key={category}
                type={curveType}
                dataKey={category}
                stroke={getLineColor(idx)}
                strokeWidth={2}
                connectNulls={connectNulls}
                dot={false}
                activeDot={ACTIVE_DOT}
              />
            ))}
      </ChartComponent>
    </ResponsiveContainer>
  )
}

export default React.memo(LineChartImpl)
