/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CompanyDetailTabs } from '../CompanyDetailTabs'

let mockGrantedFeatures: string[] = []
let mockDealsInProduct = true

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: true,
  }),
}))

jest.mock('@open-mercato/shared/lib/product-scope', () => ({
  get DEALS_IN_PRODUCT() {
    return mockDealsInProduct
  },
}))

function renderTabs() {
  return render(
    <CompanyDetailTabs activeTab="people" onTabChange={() => {}}>
      <div>content</div>
    </CompanyDetailTabs>,
  )
}

describe('CompanyDetailTabs', () => {
  beforeEach(() => {
    mockDealsInProduct = true
  })

  it('renders the Deals tab when the user has customers.deals.view', () => {
    mockGrantedFeatures = ['customers.companies.view', 'customers.deals.view']
    renderTabs()
    expect(screen.getByRole('tab', { name: /deals/i })).toBeInTheDocument()
  })

  it('hides the Deals tab when the user lacks customers.deals.view', () => {
    mockGrantedFeatures = ['customers.companies.view']
    renderTabs()
    expect(screen.queryByRole('tab', { name: /deals/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /people/i })).toBeInTheDocument()
  })

  it('renders the Deals tab for a wildcard customers.* grant', () => {
    mockGrantedFeatures = ['customers.*']
    renderTabs()
    expect(screen.getByRole('tab', { name: /deals/i })).toBeInTheDocument()
  })

  // The product-scope flag has to win over the ACL answer, including over the
  // `customers.*` wildcard the admin role is seeded with — that wildcard is the
  // reason withholding deals cannot be expressed as a revoked grant.
  it('hides the Deals tab when deals are withheld from the product, even with a wildcard grant', () => {
    mockDealsInProduct = false
    mockGrantedFeatures = ['customers.*']
    renderTabs()
    expect(screen.queryByRole('tab', { name: /deals/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /people/i })).toBeInTheDocument()
  })
})
