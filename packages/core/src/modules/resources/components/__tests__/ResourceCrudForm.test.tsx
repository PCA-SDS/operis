/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { useResourcesResourceFormConfig } from '../ResourceCrudForm'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()

jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionarySelectControl', () => ({
  DictionarySelectControl: () => <div data-testid="dictionary-select" />,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: () => <div data-testid="appearance-selector" />,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentsSection: () => <div data-testid="attachments-section" />,
  TagsSection: () => <div data-testid="tags-section" />,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/icon-button', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => {
  const React = require('react')
  const Ctx = React.createContext({ onValueChange: (_value: string) => {} })
  return {
    Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (value: string) => void }) => (
      <Ctx.Provider value={{ onValueChange: onValueChange ?? (() => {}) }}>
        {children}
      </Ctx.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => (
      <span data-testid="select-value">{children ?? placeholder ?? null}</span>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const ctx = React.useContext(Ctx)
      return (
        <button type="button" onClick={() => ctx.onValueChange(value)}>
          {children}
        </button>
      )
    },
  }
})

function AreaFieldHarness({ selectedAreaId }: { selectedAreaId: string }) {
  const config = useResourcesResourceFormConfig({ selectedAreaId })
  const areaField = config.fields.find((field) => field.id === 'areaId')
  if (!areaField?.component) return null
  return (
    <>
      {areaField.component({
        value: selectedAreaId,
        setValue: jest.fn(),
        disabled: false,
      })}
    </>
  )
}

describe('ResourceCrudForm', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockReadApiResultOrThrow.mockReset()
  })

  it('renders the selected area label when the selected option is fetched by id', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/resources/resource-types')) {
        return { result: { items: [] } }
      }
      if (url.startsWith('/api/dictionaries')) {
        return { result: { items: [] } }
      }
      return { result: { items: [] } }
    })
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/resources/areas')) {
        const params = new URL(`http://localhost${url}`).searchParams
        if (params.get('ids') === 'area-selected') {
          return {
            items: [
              {
                id: 'area-selected',
                name: 'Remote warehouse',
                parent_area_id: null,
                sort_order: 0,
                depth: 0,
              },
            ],
            totalPages: 1,
          }
        }
        return {
          items: [
            {
              id: 'area-first-page',
              name: 'Front office',
              parent_area_id: null,
              sort_order: 0,
              depth: 0,
            },
          ],
          totalPages: 1,
        }
      }
      return { items: [] }
    })

    render(<AreaFieldHarness selectedAreaId="area-selected" />)

    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalledWith(
        expect.stringContaining('ids=area-selected'),
        undefined,
        expect.any(Object),
      )
    })
    expect(await screen.findAllByRole('button', { name: /Remote warehouse/ })).toHaveLength(2)
  })
})
