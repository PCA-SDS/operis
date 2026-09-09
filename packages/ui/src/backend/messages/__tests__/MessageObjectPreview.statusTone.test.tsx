/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MessageObjectPreview, STATUS_TONE_CLASSES } from '../MessageObjectPreview'

function renderWithStatus(status: string, statusColor?: string) {
  render(
    <MessageObjectPreview
      entityId="e1"
      entityModule="sales"
      entityType="order"
      previewData={{ title: 'Order 1', status, statusColor }}
    />,
  )
  return screen.getByText(status)
}

describe('MessageObjectPreview status tone', () => {
  it.each([
    ['green', 'status-success'],
    ['red', 'status-error'],
    ['amber', 'status-warning'],
    ['blue', 'status-info'],
  ])('paints a %s status with the %s ramp', (statusColor, ramp) => {
    // Every module computes a severity name; the chip used to render neutral, so
    // a "Cancelled" order and a "Paid" order looked identical.
    const badge = renderWithStatus('Some status', statusColor)
    expect(badge.className).toContain(`bg-${ramp}-bg`)
    expect(badge.className).toContain(`text-${ramp}-text`)
  })

  it('leaves gray and unknown names on the neutral outline', () => {
    expect(STATUS_TONE_CLASSES.gray).toBe('')
    const badge = renderWithStatus('Draft', 'chartreuse')
    expect(badge.className).not.toContain('bg-status-')
  })

  it('falls back to neutral when the producer omits statusColor', () => {
    const badge = renderWithStatus('Draft')
    expect(badge.className).not.toContain('bg-status-')
  })
})
