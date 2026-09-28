/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { IconButton } from '../icon-button'
import { Tabs, TabsList, TabsTrigger } from '../tabs'
import { FormSection } from '../../backend/forms/FormSection'

describe('IconButton soft variant', () => {
  it('paints the neutral soft fill with a transparent border, white only inside a form section', () => {
    render(<IconButton variant="soft" aria-label="Edit">x</IconButton>)
    const classes = screen.getByRole('button', { name: 'Edit' }).className.split(/\s+/)
    expect(classes).toContain('bg-primary-soft')
    expect(classes).toContain('border-transparent')
    expect(classes).not.toContain('bg-surface')
    expect(classes).toContain('in-data-[crud-section=true]:bg-surface')
  })

  it('draws the default outline variant as the same borderless soft button', () => {
    render(<IconButton aria-label="Edit">x</IconButton>)
    const classes = screen.getByRole('button', { name: 'Edit' }).className.split(/\s+/)
    expect(classes).toContain('bg-primary-soft')
    expect(classes).toContain('border-transparent')
    expect(classes).not.toContain('border-border')
  })
})

describe('Tabs keep one width per tab', () => {
  it('sets every tab in the same weight, so selecting one moves nothing', () => {
    render(
      <Tabs value="a" onValueChange={() => {}}>
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Alpha', 'Beta'])
    for (const tab of tabs) {
      expect(tab.className.split(/\s+/)).toContain('font-medium')
      expect(tab.className).not.toMatch(/font-(semibold|bold)/)
    }
  })
})

describe('FormSection panel', () => {
  it('draws the tinted section panel by default', () => {
    const { container } = render(<FormSection title="Details">field</FormSection>)
    expect(container.querySelector('[data-crud-section="true"]')).not.toBeNull()
  })

  it('lays the fields out flat when panel is false', () => {
    const { container } = render(<FormSection title="Details" panel={false}>field</FormSection>)
    expect(container.querySelector('[data-crud-section]')).toBeNull()
    expect(container.textContent).toContain('field')
  })
})
