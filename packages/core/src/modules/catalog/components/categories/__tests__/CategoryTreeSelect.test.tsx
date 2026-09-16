/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategoryTreeSelect } from '../CategoryTreeSelect'

const mockReadApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})
jest.mock('@open-mercato/ui/primitives/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const tree = [
  {
    id: 'root-1',
    name: 'Root',
    parentId: null,
    depth: 0,
    pathLabel: 'Root',
    childIds: ['child-1'],
    descendantIds: ['child-1'],
    children: [
      {
        id: 'child-1',
        name: 'Child',
        parentId: 'root-1',
        depth: 1,
        pathLabel: 'Root / Child',
        childIds: [],
        descendantIds: [],
        children: [],
      },
    ],
  },
]

describe('CategoryTreeSelect', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('loads and selects a category from the tree', async () => {
    const handleChange = jest.fn()
    mockReadApiResultOrThrow.mockResolvedValue({ items: tree })
    render(<CategoryTreeSelect value={null} onChange={handleChange} />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Root' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('option', { name: 'Root' }))

    expect(handleChange).toHaveBeenCalledWith('root-1')
  })

  it('expands ancestors and shows the selected label', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: tree })
    render(<CategoryTreeSelect value="child-1" onChange={jest.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Root \/ Child/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: 'Child' })).toBeInTheDocument()
  })

  it('excludes the current subtree from options', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: tree })
    render(<CategoryTreeSelect value={null} onChange={jest.fn()} excludeSubtreeOf="root-1" />)

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Root' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('option', { name: 'Child' })).not.toBeInTheDocument()
  })
})
