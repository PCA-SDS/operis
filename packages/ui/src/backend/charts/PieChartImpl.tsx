"use client"

import * as React from 'react'
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Label,
} from 'recharts'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'
import type { PieChartProps } from './PieChart'

type ImplProps = Pick<
  PieChartProps,
  'data' | 'colors' | 'variant' | 'valueFormatter' | 'showLabel' | 'showTooltip'
> & {
  valueFormatter: (value: number) => string
  total: number
}

const LEGEND_LABEL_STYLE: React.CSSProperties = { color: 'hsl(var(--muted-foreground))', fontSize: '12px' }

function renderLegendLabel(value: React.ReactNode): React.ReactNode {
  return <span style={LEGEND_LABEL_STYLE}>{value}</span>
}

function PieChartImpl({
  data,
  colors,
  variant = 'donut',
  valueFormatter,
  showLabel = true,
  showTooltip = true,
  total,
}: ImplProps) {
  const getSliceColor = React.useCallback(
    (idx: number): string => resolveChartColor(colors?.[idx], idx),
    [colors],
  )
  const innerRadius = variant === 'donut' ? '60%' : 0
  const outerRadius = '80%'

  const tooltipContent = React.useMemo(
    () => (
      <ChartTooltipContent
        valueFormatter={valueFormatter}
        hideLabel
      />
    ),
    [valueFormatter],
  )

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsPieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="40%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, idx) => (
            <Cell key={`cell-${idx}`} fill={getSliceColor(idx)} />
          ))}
          {showLabel && variant === 'donut' && (
            <Label
              value={valueFormatter(total)}
              position="center"
              className="fill-foreground text-2xl font-bold"
            />
          )}
        </Pie>
        {showTooltip && (
          <Tooltip
            content={tooltipContent}
          />
        )}
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={renderLegendLabel}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  )
}

export default React.memo(PieChartImpl)
