/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ParentRoleSelect } from '../components/ParentRoleSelect'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const dict = {
  'auth.roles.form.field.parentRoleNone': 'No parent (top level)',
}

describe('ParentRoleSelect', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('loads parent roles using the supported API page size', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      items: [{ id: 'role-parent', name: 'Org Parent A' }],
      totalPages: 1,
    })

    renderWithProviders(<ParentRoleSelect value={null} onChange={jest.fn()} />, { dict })

    await waitFor(() => {
      expect(readApiResultOrThrow).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Org Parent A' })).toBeInTheDocument()

    const requestUrl = (readApiResultOrThrow as jest.Mock).mock.calls[0][0] as string
    expect(requestUrl).toContain('page=1')
    expect(requestUrl).toContain('pageSize=100')
  })

  it('loads parent roles from every available page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `role-${index}`,
      name: `Role ${index}`,
    }))
    ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('page=2')) {
        return { items: [{ id: 'role-parent-2', name: 'Org Parent B' }], totalPages: 2 }
      }
      return { items: firstPage, totalPages: 2 }
    })

    renderWithProviders(<ParentRoleSelect value={null} onChange={jest.fn()} />, { dict })

    await waitFor(() => {
      expect(readApiResultOrThrow).toHaveBeenCalledTimes(2)
    })
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Org Parent B' })).toBeInTheDocument()

    const requestUrls = (readApiResultOrThrow as jest.Mock).mock.calls.map(([url]) => url as string)
    expect(requestUrls).toEqual(expect.arrayContaining([
      expect.stringContaining('page=1'),
      expect.stringContaining('page=2'),
    ]))
  })

  it('does not offer the role being edited as its own parent', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 'role-current', name: 'Current role' },
        { id: 'role-parent', name: 'Org Parent A' },
      ],
      totalPages: 1,
    })

    renderWithProviders(
      <ParentRoleSelect value={null} excludeRoleId="role-current" onChange={jest.fn()} />,
      { dict },
    )

    await waitFor(() => {
      expect(readApiResultOrThrow).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: 'Org Parent A' })).toBeInTheDocument()

    expect(screen.queryByRole('option', { name: 'Current role' })).not.toBeInTheDocument()
  })
})
