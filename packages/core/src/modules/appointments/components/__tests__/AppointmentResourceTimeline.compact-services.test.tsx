/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { AppointmentResourceTimeline } from '../AppointmentResourceTimeline'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

describe('AppointmentResourceTimeline compact service labels', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    })
  })

  it('shows all services in a compact booking block', () => {
    render(
      <AppointmentResourceTimeline
        date="2026-09-28"
        timelineWindows={[{
          startsAt: '2026-09-28T02:00:00.000Z',
          endsAt: '2026-09-28T16:00:00.000Z',
        }]}
        resources={[{ id: 'resource-102', name: 'Lash Nail 102' }]}
        appointments={[{
          id: 'appointment-1',
          customerName: 'Joshua Fang Hau',
          customerSalutation: null,
        }]}
        blocks={[{
          id: 'assignment-1',
          appointmentId: 'appointment-1',
          resourceId: 'resource-102',
          startsAt: '2026-09-28T13:00:00.000Z',
          endsAt: '2026-09-28T13:30:00.000Z',
          state: 'draft',
          serviceName: 'Natural Glow',
        }, {
          id: 'assignment-2',
          appointmentId: 'appointment-1',
          resourceId: 'resource-102',
          startsAt: '2026-09-28T13:30:00.000Z',
          endsAt: '2026-09-28T14:15:00.000Z',
          state: 'draft',
          serviceName: 'Radiant Cleansing',
        }]}
      />,
    )

    expect(screen.getByText('Natural Glow')).toBeInTheDocument()
    expect(screen.getByText('Radiant Cleansing')).toBeInTheDocument()
  })

  it('renders attachment-backed resource icons as images', () => {
    const iconUrl = '/api/attachments/file/attachment-1'
    const { container } = render(
      <AppointmentResourceTimeline
        date="2026-09-28"
        resources={[{
          id: 'resource-101',
          name: 'Lash Nail 101',
          appearanceIcon: iconUrl,
        }]}
        appointments={[]}
        blocks={[]}
      />,
    )

    expect(container.querySelector(`img[src="${iconUrl}"]`)).not.toBeNull()
    expect(screen.queryByText(iconUrl)).not.toBeInTheDocument()
  })
})
