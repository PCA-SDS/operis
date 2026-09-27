/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { InvoiceForecastDto, InvoiceSummaryDto } from '../../../data/mappers'
import InvoiceDashboardPage from '../page'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  LineChart: () => null,
  PieChart: () => null,
}))

jest.mock('../components/InvoiceSyncButton', () => ({
  InvoiceSyncButton: () => null,
}))

jest.mock('@open-mercato/ui/primitives/slider', () => ({
  Slider: () => null,
}))

const bucket = { amount: '0', count: 0 }
const series = { overdue: bucket, undated: bucket, beyondHorizon: bucket, points: [] }
const direction = { outstandingAmount: '0', overdueAmount: '0', count: 0 }

function forecastWithHorizon(horizonDays: number): InvoiceForecastDto {
  return {
    currency: 'VND',
    ratesStale: false,
    today: '2026-09-27',
    horizonDays,
    entries: [],
    receivable: series,
    payable: series,
    net: { points: [] },
    series: [],
    totals: { arAmount: '0', apAmount: '0', netAmount: '0' },
  } as unknown as InvoiceForecastDto
}

const summary = {
  currency: 'VND',
  ar: direction,
  ap: direction,
  netPosition: '0',
  net: '0',
  netOutstanding: '0',
  ratesStale: false,
} as unknown as InvoiceSummaryDto

function serveForecast(horizonDays: number) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/invoice/forecast')) return { ok: true, result: forecastWithHorizon(horizonDays) }
    if (url.startsWith('/api/invoice/invoices')) return { ok: true, result: { items: [] } }
    if (url.startsWith('/api/invoice/summary')) return { ok: true, result: summary }
    return { ok: false, result: null }
  })
}

function checkedRanges() {
  return screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true')
}

describe('InvoiceDashboardPage forecast range', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('is the shared switcher, named by the forecast heading, starting on 30 days', async () => {
    serveForecast(365)
    renderWithProviders(<InvoiceDashboardPage />)
    const range = await screen.findByRole('radiogroup', { name: 'Cash-flow forecast' })
    expect(range).toHaveAttribute('data-slot', 'segmented-control')
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(checkedRanges().map((radio) => radio.getAttribute('value'))).toEqual(['30'])
  })

  it('moves the cutoff to the whole horizon and asks for the unbounded summary', async () => {
    serveForecast(365)
    renderWithProviders(<InvoiceDashboardPage />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Forecast horizon' }))
    await waitFor(() => expect(checkedRanges().map((radio) => radio.getAttribute('value'))).toEqual(['horizon']))
    expect(apiCallMock).toHaveBeenLastCalledWith('/api/invoice/summary')
  })

  it('lights exactly one segment when a preset is the horizon itself', async () => {
    serveForecast(90)
    renderWithProviders(<InvoiceDashboardPage />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Forecast horizon' }))
    await waitFor(() => expect(checkedRanges().map((radio) => radio.getAttribute('value'))).toEqual(['90']))
  })
})
