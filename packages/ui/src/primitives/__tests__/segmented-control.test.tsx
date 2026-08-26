/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { SegmentedControl, SegmentedControlItem } from '../segmented-control'

function Controlled({
  initial = 'all',
  size,
  fullWidth,
  disabled,
  onChange,
}: {
  initial?: string
  size?: 'sm' | 'default'
  fullWidth?: boolean
  disabled?: boolean
  onChange?: (next: string) => void
}) {
  const [value, setValue] = React.useState(initial)
  return (
    <SegmentedControl
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      aria-label="View"
    >
      <SegmentedControlItem value="all">All</SegmentedControlItem>
      <SegmentedControlItem value="active">Active</SegmentedControlItem>
      <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
    </SegmentedControl>
  )
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio item per child', () => {
    const { container, getByRole, getAllByRole } = render(<Controlled />)
    const root = getByRole('radiogroup', { name: 'View' })
    expect(root).toBeInTheDocument()
    expect(root.getAttribute('data-slot')).toBe('segmented-control')
    const items = getAllByRole('radio')
    expect(items.length).toBe(3)
    expect(container.querySelectorAll('[data-slot="segmented-control-item"]').length).toBe(3)
  })

  it('marks the initial value as checked', () => {
    const { getByRole } = render(<Controlled initial="active" />)
    const all = getByRole('radio', { name: 'All' })
    const active = getByRole('radio', { name: 'Active' })
    const archived = getByRole('radio', { name: 'Archived' })
    expect(all.getAttribute('aria-checked')).toBe('false')
    expect(active.getAttribute('aria-checked')).toBe('true')
    expect(active.getAttribute('data-state')).toBe('checked')
    expect(archived.getAttribute('aria-checked')).toBe('false')
  })

  it('fires onValueChange when an unselected item is clicked', () => {
    const onChange = jest.fn()
    const { getByRole } = render(<Controlled onChange={onChange} />)
    fireEvent.click(getByRole('radio', { name: 'Active' }))
    expect(onChange).toHaveBeenCalledWith('active')
  })

  it('updates aria-checked + data-state after selection', () => {
    const { getByRole } = render(<Controlled />)
    fireEvent.click(getByRole('radio', { name: 'Archived' }))
    expect(getByRole('radio', { name: 'Archived' }).getAttribute('aria-checked')).toBe('true')
    expect(getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('false')
  })

  it('applies size="default" classes by default (h-9 track, text-sm items)', () => {
    const { container } = render(<Controlled />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('h-9')
    expect(root.className).toContain('rounded-lg')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('text-sm')
  })

  it('applies size="sm" classes (h-8 track, text-xs items)', () => {
    const { container } = render(<Controlled size="sm" />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('h-8')
    expect(root.className).not.toContain('h-9')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('text-xs')
  })

  it('lets items stretch to the track instead of carrying their own height', () => {
    // The pill is inset by the track's p-0.5 on every side only while the item
    // fills the track's content box. A fixed item height reintroduces a
    // different vertical gap than the horizontal one.
    const { container } = render(<Controlled />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('items-stretch')
    expect(root.className).toContain('p-0.5')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).not.toMatch(/(^|\s)h-\d/)
  })

  it('disables all items when disabled prop is set on the root', () => {
    const onChange = jest.fn()
    const { container, getByRole } = render(<Controlled disabled onChange={onChange} />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('opacity-60')
    const items = container.querySelectorAll('[data-slot="segmented-control-item"]')
    items.forEach((item) => {
      expect((item as HTMLButtonElement).disabled).toBe(true)
    })
    fireEvent.click(getByRole('radio', { name: 'Active' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards ref to the root element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <SegmentedControl ref={ref} value="a" onValueChange={() => {}} aria-label="x">
        <SegmentedControlItem value="a">A</SegmentedControlItem>
        <SegmentedControlItem value="b">B</SegmentedControlItem>
      </SegmentedControl>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('segmented-control')
  })

  it('forwards className without dropping variant classes', () => {
    const { container } = render(
      <SegmentedControl value="a" onValueChange={() => {}} className="custom-class">
        <SegmentedControlItem value="a">A</SegmentedControlItem>
      </SegmentedControl>,
    )
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('custom-class')
    expect(root.className).toContain('rounded-lg')
    expect(root.className).toContain('bg-surface')
  })

  it('renders the sliding indicator only inside the checked item', () => {
    const { container, getByRole } = render(<Controlled initial="active" />)
    const indicators = container.querySelectorAll('[data-slot="segmented-control-indicator"]')
    expect(indicators.length).toBe(1)
    const checked = getByRole('radio', { name: 'Active' })
    expect(checked.contains(indicators[0])).toBe(true)
  })

  it('moves the indicator into the newly checked item on selection', () => {
    const { container, getByRole } = render(<Controlled initial="all" />)
    fireEvent.click(getByRole('radio', { name: 'Archived' }))
    const indicators = container.querySelectorAll('[data-slot="segmented-control-indicator"]')
    expect(indicators.length).toBe(1)
    expect(getByRole('radio', { name: 'Archived' }).contains(indicators[0])).toBe(true)
    expect(getByRole('radio', { name: 'All' }).querySelector('[data-slot="segmented-control-indicator"]')).toBeNull()
  })

  it('paints the selected fill on the indicator, not on the item', () => {
    // The item carries only the text treatment; the pill carries the fill, so
    // that the fill is a single element able to slide between segments.
    const { container, getByRole } = render(<Controlled initial="all" />)
    const indicator = container.querySelector('[data-slot="segmented-control-indicator"]') as HTMLElement
    expect(indicator.className).toContain('bg-sidebar')
    expect(indicator.className).toContain('absolute')
    const checked = getByRole('radio', { name: 'All' })
    expect(checked.className).toContain('data-[state=checked]:font-semibold')
    expect(checked.className).not.toContain('data-[state=checked]:bg-sidebar')
  })

  it('inks the checked label against the sidebar fill', () => {
    // The pill is a saturated sidebar-navy fill, so the selected label has to
    // switch to the sidebar's own foreground or it is unreadable on top of it.
    const { getByRole } = render(<Controlled />)
    const item = getByRole('radio', { name: 'All' })
    expect(item.className).toContain('data-[state=checked]:text-sidebar-foreground')
    expect(item.className).toContain('data-[state=unchecked]:text-muted-foreground')
  })

  it('crossfades label colour over the same window the pill travels in', () => {
    // A snap to the selected ink would leave light text on the light rail for
    // as long as the pill is still in transit.
    const { container } = render(<Controlled />)
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('transition-colors')
    expect(item.className).toContain('duration-200')
    expect(item.className).toContain('motion-reduce:transition-none')
  })

  it('keeps the indicator radius inline so framer-motion can counter-scale it', () => {
    // A layout animation resizes the pill via scaleX/scaleY, which stretches
    // corner radii. framer-motion corrects that only for a numeric radius it
    // can read off `style` — moving this back to a `rounded-md` class would
    // silently reintroduce elliptical corners mid-slide.
    const { container } = render(<Controlled />)
    const indicator = container.querySelector('[data-slot="segmented-control-indicator"]') as HTMLElement
    expect(indicator.style.borderRadius).toBe('6px')
    expect(indicator.className).not.toContain('rounded-md')
  })

  it('reserves the semibold width on every item so selection cannot reflow the track', () => {
    // Checked labels are semibold and unchecked ones medium; without a
    // reserved column, selecting would widen the item and shift its siblings
    // while the pill is mid-slide.
    const { getByRole } = render(<Controlled initial="all" />)
    const unchecked = getByRole('radio', { name: 'Active' })
    const ghost = unchecked.querySelector('[aria-hidden="true"].invisible') as HTMLElement
    expect(ghost).not.toBeNull()
    expect(ghost.className).toContain('font-semibold')
    expect(ghost.textContent).toBe('Active')
  })

  it('does not compound the item dim with the track dim when the group is disabled', () => {
    // opacity-60 on the track multiplied by opacity-50 on each item rendered
    // the disabled control at ~0.3 — fainter than either dim intends.
    const { container } = render(<Controlled disabled />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('opacity-60')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('disabled:opacity-100')
    expect(item.className).not.toContain('disabled:opacity-50')
  })

  it('keeps the item dim when only a single item is disabled inside an enabled group', () => {
    const { container } = render(
      <SegmentedControl value="a" onValueChange={() => {}} aria-label="x">
        <SegmentedControlItem value="a">A</SegmentedControlItem>
        <SegmentedControlItem value="b" disabled>B</SegmentedControlItem>
      </SegmentedControl>,
    )
    const items = container.querySelectorAll('[data-slot="segmented-control-item"]')
    expect((items[1] as HTMLElement).className).toContain('disabled:opacity-50')
  })

  it('scopes the indicator layout id per instance so two controls do not share a pill', () => {
    // A shared layoutId is global to framer-motion: without per-instance
    // scoping, selecting in one control would fly the other control's pill
    // across the page.
    const { container } = render(
      <>
        <Controlled initial="all" />
        <Controlled initial="active" />
      </>,
    )
    const indicators = container.querySelectorAll('[data-slot="segmented-control-indicator"]')
    expect(indicators.length).toBe(2)
  })

  it('hugs its content by default and shares the track equally when fullWidth', () => {
    const compact = render(<Controlled />)
    const compactRoot = compact.container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(compactRoot.className).toContain('inline-flex')
    expect(compactRoot.className).toContain('w-fit')
    const compactItem = compact.container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(compactItem.className).not.toContain('flex-1')
    compact.unmount()

    const wide = render(<Controlled fullWidth />)
    const wideRoot = wide.container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(wideRoot.className).toContain('w-full')
    expect(wideRoot.className).not.toContain('w-fit')
    wide.container.querySelectorAll('[data-slot="segmented-control-item"]').forEach((item) => {
      // basis-0 alongside flex-1 is what makes the shares equal rather than
      // weighted by label length.
      expect((item as HTMLElement).className).toContain('flex-1')
      expect((item as HTMLElement).className).toContain('basis-0')
    })
  })

  it('renders a leading icon without letting it into the accessible name', () => {
    const { container, getByRole } = render(
      <SegmentedControl value="a" onValueChange={() => {}} aria-label="x">
        <SegmentedControlItem value="a" icon={<svg data-testid="glyph" />}>
          Meetings
        </SegmentedControlItem>
        <SegmentedControlItem value="b">Events</SegmentedControlItem>
      </SegmentedControl>,
    )
    const icons = container.querySelectorAll('[data-slot="segmented-control-item-icon"]')
    expect(icons.length).toBe(1)
    expect(icons[0].getAttribute('aria-hidden')).toBe('true')
    expect(getByRole('radio', { name: 'Meetings' })).toBeInTheDocument()
  })

  it('keeps the icon outside the label width-reservation grid', () => {
    // The ghost copy exists to freeze the semibold label width; an icon does
    // not change width with font weight, so duplicating it is pure cost.
    const { container } = render(
      <SegmentedControl value="a" onValueChange={() => {}} aria-label="x">
        <SegmentedControlItem value="a" icon={<svg data-testid="glyph" />}>
          Meetings
        </SegmentedControlItem>
      </SegmentedControl>,
    )
    expect(container.querySelectorAll('[data-testid="glyph"]').length).toBe(1)
  })
})
