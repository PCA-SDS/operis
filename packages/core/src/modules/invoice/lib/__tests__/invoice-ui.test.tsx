/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { useInvoiceT } from '../useInvoiceT'
import { addCalendarMonths, issuedRange, localDate } from '../localDates'
import { invoiceTotals } from '../lineTotals'
import english from '../../i18n/en.json'

describe('invoice UI regressions', () => {
  const localeDirectory = path.join(__dirname, '../../i18n')
  test.each(readdirSync(localeDirectory).filter((file) => file.endsWith('.json')))('resolves invoice labels in %s with readable fallbacks', (file) => {
    const dict = JSON.parse(readFileSync(path.join(localeDirectory, file), 'utf8'))
    const { result } = renderHook(useInvoiceT, { wrapper: ({ children }) => <I18nProvider locale={file.replace('.json', '') as Locale} dict={dict}>{children}</I18nProvider> })
    for (const key of Object.keys(english)) {
      expect(result.current(key)).not.toBe(key)
    }
    expect(result.current('missing.key', 'Item {number}', { number: 2 })).toBe('Item 2')
  })

  test('every static invoice UI key has an English fallback', () => {
    const missing = new Set<string>()
    const invalidFallbacks: string[] = []
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name)
        if (entry.isDirectory()) visit(filename)
        else if (filename.endsWith('.tsx')) {
          const source = readFileSync(filename, 'utf8')
          for (const match of source.matchAll(/\bt\('(invoice\.[^']+)'/g)) {
            if (!(match[1] in english)) missing.add(match[1])
          }
          if (/\bt\([^\n]*?,\s*\{\s*fallback:/.test(source)) invalidFallbacks.push(filename)
        }
      }
    }
    visit(path.join(__dirname, '../../backend'))
    expect([...missing]).toEqual([])
    expect(invalidFallbacks).toEqual([])
  })

  test('quick ranges distinguish yesterday, the previous week, and rolling days', () => {
    const today = new Date(2026, 8, 15)
    expect(issuedRange('yesterday', today)).toEqual(['2026-09-14', '2026-09-14'])
    expect(issuedRange('lastWeek', today)).toEqual(['2026-09-07', '2026-09-13'])
    expect(issuedRange('last7Days', today)).toEqual(['2026-09-09', '2026-09-15'])
    expect(issuedRange('lastMonth', today)).toEqual(['2026-08-01', '2026-08-31'])
    expect(issuedRange('last3Months', today)).toEqual(['2026-06-01', '2026-08-31'])
    expect(issuedRange('last12Months', today)).toEqual(['2025-09-01', '2026-08-31'])
  })

  test('monthly dates keep the local day and clamp at month end', () => {
    expect(localDate(new Date(2026, 8, 20))).toBe('2026-09-20')
    expect(addCalendarMonths('2026-09-20', 1)).toBe('2026-10-20')
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29')
  })

  test('calculates amount and percentage discounts before VAT with four-decimal rounding', () => {
    expect(invoiceTotals([
      { quantity: '2', unitPrice: '100', discountPercent: 10, vatRate: 10 },
      { quantity: '1', unitPrice: '50', discountAmount: '5', vatRate: 8 },
    ])).toEqual({ subtotal: 225, vat: 21.6, total: 246.6 })
    expect(invoiceTotals([{ quantity: '3', unitPrice: '0.3333', vatRate: 10 }])).toEqual({ subtotal: 0.9999, vat: 0.1, total: 1.0999 })
  })
})
