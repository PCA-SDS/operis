/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EmailThreadsPanel } from '../EmailThreadsPanel'

function renderPanel(actionVariant?: 'outline' | 'soft') {
  return renderWithProviders(
    <EmailThreadsPanel
      threads={[]}
      canCompose
      onComposeNew={() => {}}
      onRefresh={() => {}}
      actionVariant={actionVariant}
    />,
    { dict: {} },
  )
}

describe('EmailThreadsPanel actionVariant', () => {
  it('keeps the small outline refresh button by default', () => {
    renderPanel()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.className).toContain('border-border')
    expect(refresh.className).toContain('h-8')
  })

  it('renders 36px soft actions when actionVariant is soft', () => {
    renderPanel('soft')
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.className).toContain('bg-primary-soft')
    expect(refresh.className).toContain('h-9')
    expect(screen.getByRole('button', { name: 'New email' }).className).toContain('h-9')
  })
})
