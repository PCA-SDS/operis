"use client"

import * as React from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { BarChartDataItem, BarChartProps } from './BarChart'

type ImplProps = Pick<
  BarChartProps,
  | 'data'
  | 'index'
  | 'categories'
  | 'colors'
  | 'layout'
  | 'valueFormatter'
  | 'showLegend'
  | 'showGridLines'
  | 'categoryLabels'
> & {
  valueFormatter: (value: number) => string
}

const CHART_MARGIN = { top: 5, right: 30, left: 20, bottom: 5 }
const X_AXIS_TICK = { fontSize: 11 }
const Y_AXIS_TICK = { fontSize: 10 }
const TOOLTIP_CURSOR = { fill: 'hsl(var(--muted))', opacity: 0.2 }

function BarChartImpl({
  data,
  index,
  categories,
  colors,
  layout = 'vertical',
  valueFormatter,
  showLegend = true,
  showGridLines = true,
  categoryLabels,
}: ImplProps) {
  const isHorizontal = layout === 'horizontal'
  const chartHeight = isHorizontal ? Math.max(200, data.length * 28) : 200
  const getBarColor = React.useCallback(
    (idx: number): string => resolveChartColor(colors?.[idx], idx),
    [colors],
  )

  const tooltipContent = React.useMemo(
    () => (
      <ChartTooltipContent
        valueFormatter={valueFormatter}
        categoryLabels={categoryLabels}
        labelFormatter={(label, payload) => {
          const entry = payload?.[0] as { payload?: BarChartDataItem } | undefined
          const item = entry?.payload
          return item?.[index] ? String(item[index]) : label
        }}
      />
    ),
    [valueFormatter, categoryLabels, index],
  )

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={CHART_MARGIN}
      >
        {showGridLines && (
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        )}
        <XAxis
          type={isHorizontal ? 'number' : 'category'}
          dataKey={isHorizontal ? undefined : index}
          tickFormatter={isHorizontal ? valueFormatter : undefined}
          tick={X_AXIS_TICK}
        />
        <YAxis
          type={isHorizontal ? 'category' : 'number'}
          dataKey={isHorizontal ? index : undefined}
          tickFormatter={isHorizontal ? undefined : valueFormatter}
          width={isHorizontal ? 90 : 50}
          interval={0}
          tick={Y_AXIS_TICK}
        />
        <Tooltip
          content={tooltipContent}
          cursor={TOOLTIP_CURSOR}
        />
        {showLegend && categories.length > 1 && (
          <Legend verticalAlign="top" height={36} />
        )}
        {categories.map((category, idx) => (
          <Bar
            key={category}
            dataKey={category}
            fill={getBarColor(idx)}
            radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}

export default React.memo(BarChartImpl)
