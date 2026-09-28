/**
 * @jest-environment jsdom
 */
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { screen } from '@testing-library/react'
import { ActivityCard } from '../ActivityCard'
import type { InteractionSummary } from '../types'

// The email-card actions are exercised by their own/integration tests; stub them
// here so ActivityCard's unit tests don't need a Next router / mutation provider.
jest.mock('../EmailCardActions', () => ({
  EmailCardActions: () => null,
}))

function createActivity(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id: 'activity-1',
    interactionType: 'call',
    title: 'Discovery call',
    body: 'Discussed roadmap, pricing, and next steps for rollout.',
    status: 'done',
    scheduledAt: null,
    occurredAt: '2026-04-10T09:30:00.000Z',
    priority: null,
    authorUserId: 'user-1',
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: 'manual',
    entityId: 'company-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: 'Jane Doe',
    authorEmail: 'jane@example.com',
    dealTitle: null,
    customValues: null,
    createdAt: '2026-04-10T09:30:00.000Z',
    updatedAt: '2026-04-10T09:30:00.000Z',
    duration: 32,
    location: 'Remote',
    participants: [{ userId: 'participant-1', name: 'Sarah Mitchell', status: 'accepted' }],
    ...overrides,
  }
}

describe('ActivityCard', () => {
  it('renders a call as a history row: title, body, location and one quiet meta line', () => {
    renderWithProviders(<ActivityCard activity={createActivity()} />)

    expect(screen.getByText('Discovery call')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('Discussed roadmap, pricing, and next steps for rollout.')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('with')).toBeInTheDocument()
    expect(screen.getByText('Sarah Mitchell')).toBeInTheDocument()
    // The duration moved out of the title into the meta line.
    expect(screen.getByText('32m')).toBeInTheDocument()
    // No placeholder AI chips: they had no actions behind them.
    expect(screen.queryByRole('button', { name: /Summarize/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Action items/i })).toBeNull()
  })

  it('titles an untitled activity by its type and keeps its body', () => {
    renderWithProviders(<ActivityCard activity={createActivity({ title: null, interactionType: 'note' })} />)

    // The title and the meta line's type both read "Note".
    expect(screen.getAllByText('Note')).toHaveLength(2)
    expect(screen.getByText('Discussed roadmap, pricing, and next steps for rollout.')).toBeInTheDocument()
  })

  it('uses email recipient wording for email activities', () => {
    renderWithProviders(
      <ActivityCard
        activity={createActivity({
          id: 'activity-2',
          interactionType: 'email',
          title: 'Proposal follow-up',
          duration: null,
          participants: [{ userId: 'participant-2', email: 'buyer@example.com' }],
        })}
      />,
    )

    expect(screen.getByText('to')).toBeInTheDocument()
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show email/i })).toBeNull()
  })

  it.each(['planned', 'in_progress', 'waiting', 'follow_up_custom'])(
    'shows the Mark done affordance for open status %s',
    (status) => {
      renderWithProviders(<ActivityCard activity={createActivity({ status })} />)
      expect(screen.getByRole('button', { name: /Mark done/i })).toBeInTheDocument()
    },
  )

  it.each(['done', 'canceled'])('hides the Mark done affordance for terminal status %s', (status) => {
    renderWithProviders(<ActivityCard activity={createActivity({ status })} />)
    expect(screen.queryByRole('button', { name: /Mark done/i })).not.toBeInTheDocument()
  })
})
