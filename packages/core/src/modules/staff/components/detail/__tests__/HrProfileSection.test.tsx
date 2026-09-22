/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HrProfileSection } from '../HrProfileSection'

const readApiResultOrThrow = jest.fn()
const createCrud = jest.fn()
const updateCrud = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrow(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrud(...args),
  updateCrud: (...args: unknown[]) => updateCrud(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => <div>Loading</div>,
  ErrorMessage: () => <div>Error</div>,
  TabEmptyState: ({ actionLabel, onAction }: { actionLabel?: string; onAction?: () => void }) => (
    <button type="button" onClick={onAction}>{actionLabel ?? 'Empty'}</button>
  ),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ onSubmit }: { onSubmit: (values: Record<string, string>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSubmit({ jobTitle: 'QA Engineer' })}>
      Submit form
    </button>
  ),
}))

describe('HrProfileSection employee profile CRUD path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createCrud.mockResolvedValue({ ok: true })
    updateCrud.mockResolvedValue({ ok: true })
  })

  it('uses the CRUD path without a duplicated api prefix when creating a profile', async () => {
    readApiResultOrThrow.mockResolvedValue({ items: [] })
    render(<HrProfileSection memberId="member-1" canManage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Submit form' }))

    await waitFor(() => {
      expect(createCrud).toHaveBeenCalledWith(
        'staff/employee-profiles',
        expect.objectContaining({ memberId: 'member-1', jobTitle: 'QA Engineer' }),
      )
    })
  })

  it('uses the CRUD path without a duplicated api prefix when updating a profile', async () => {
    readApiResultOrThrow.mockResolvedValue({
      items: [{ id: 'profile-1', job_title: 'Existing role' }],
    })
    render(<HrProfileSection memberId="member-1" canManage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Submit form' }))

    await waitFor(() => {
      expect(updateCrud).toHaveBeenCalledWith(
        'staff/employee-profiles',
        expect.objectContaining({ id: 'profile-1', memberId: 'member-1', jobTitle: 'QA Engineer' }),
      )
    })
  })
})
