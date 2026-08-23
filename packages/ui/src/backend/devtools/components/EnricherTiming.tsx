'use client'

import type { EnricherTimingEntry } from '@open-mercato/shared/lib/umes/devtools-types'

function getTimingClasses(ms: number): { text: string; bar: string } {
  if (ms >= 500) return { text: 'text-status-error-icon', bar: 'bg-status-error-solid' }
  if (ms >= 100) return { text: 'text-status-warning-icon', bar: 'bg-status-warning-solid' }
  return { text: 'text-status-success-icon', bar: 'bg-status-success-solid' }
}

function getTimingBarWidth(ms: number, maxMs: number): string {
  if (maxMs === 0) return '0%'
  return `${Math.min(100, (ms / maxMs) * 100)}%`
}

export function EnricherTiming({ entries }: { entries: EnricherTimingEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs italic text-muted-foreground">No timing data</p>
  }

  const recent = entries.slice(-20).reverse()
  const maxMs = Math.max(...recent.map((e) => e.durationMs), 1)

  return (
    <div>
      {recent.map((entry, idx) => {
        const classes = getTimingClasses(entry.durationMs)
        return (
          <div key={idx} className="border-b border-border/70 py-1 text-xs">
            <div className="mb-0.5 flex justify-between">
              <span className="font-medium">{entry.enricherId}</span>
              <span className={`font-mono font-semibold ${classes.text}`}>
                {entry.durationMs}ms
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div
                className={`h-full rounded transition-[width] duration-300 ${classes.bar}`}
                style={{ width: getTimingBarWidth(entry.durationMs, maxMs) }}
              />
            </div>
            <div className="mt-px text-overline text-muted-foreground">
              {entry.targetEntity} | {entry.moduleId}
            </div>
          </div>
        )
      })}
    </div>
  )
}
