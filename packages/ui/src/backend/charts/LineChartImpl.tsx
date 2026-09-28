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
  ReferenceLine,
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
  | 'showXAxis'
  | 'showYAxis'
  | 'showZeroLine'
  | 'curveType'
  | 'connectNulls'
  | 'categoryLabels'
> & {
  valueFormatter: (value: number) => string
}

const CHART_MARGIN = { top: 5, right: 10, left: 10, bottom: 5 }
const AXIS_TICK = { fontSize: 12 }
const TOOLTIP_CURSOR = { stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }
const ACTIVE_DOT = { r: 4, strokeWidth: 0 }
const LEGEND_LABEL_STYLE: React.CSSProperties = { color: 'var(--muted-foreground)', fontSize: '12px' }

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
  showXAxis = true,
  showYAxis = true,
  showZeroLine = false,
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
            stroke="var(--border)"
          />
        )}
        <XAxis
          dataKey={index}
          tick={showXAxis ? AXIS_TICK : false}
          tickLine={false}
          axisLine={false}
          height={showXAxis ? undefined : 0}
        />
        <YAxis
          yAxisId="amount"
          tickFormatter={showYAxis ? valueFormatter : undefined}
          tick={showYAxis ? AXIS_TICK : false}
          tickLine={false}
          axisLine={false}
          width={showYAxis ? 56 : 0}
        />
        {showZeroLine && <ReferenceLine yAxisId="amount" y={0} stroke="var(--border-strong)" strokeDasharray="3 3" strokeWidth={1} />}
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
                yAxisId="amount"
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
                yAxisId="amount"
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
