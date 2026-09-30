"use client"

import * as React from 'react'
import { encode } from 'uqr'

/**
 * A QR code, drawn locally from its text — the code never leaves the browser
 * for a rendering service.
 *
 * Dark modules on a light ground in both themes: a phone camera reads that
 * contrast, and an inverted code fails on some scanners. That is the one fixed
 * colour on the accounts page, allowed for exactly this reason.
 */
export function QrCode({ value, label, size = 232 }: { value: string; label: string; size?: number }) {
  const path = React.useMemo(() => {
    const { data, size: modules } = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    for (let y = 0; y < modules; y += 1) {
      const row = data[y]
      if (!row) continue
      for (let x = 0; x < modules; x += 1) {
        if (row[x]) d += `M${x} ${y}h1v1h-1z`
      }
    }
    return { d, modules }
  }, [value])

  return (
    <div className="rounded-lg bg-white p-2 text-black shadow-sm">
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox={`0 0 ${path.modules} ${path.modules}`}
        shapeRendering="crispEdges"
      >
        <path d={path.d} fill="currentColor" />
      </svg>
    </div>
  )
}
