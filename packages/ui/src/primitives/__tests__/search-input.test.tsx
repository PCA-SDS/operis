/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SearchInput } from '../search-input'

function Harness(initial: string, props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const { onChange: consumerOnChange, ...rest } = props
  function Wrapped() {
    const [value, setValue] = React.useState(initial)
    return (
      <SearchInput
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next)
          consumerOnChange?.(next)
        }}
      />
    )
  }
  return render(<Wrapped />)
}

function wrapperOf(container: HTMLElement): HTMLElement {
  const wrapper = container.querySelector('[data-slot="search-input-wrapper"]')
  expect(wrapper).not.toBeNull()
  return wrapper as HTMLElement
}

describe('SearchInput primitive', () => {
  it('renders an input with type="search"', () => {
    const { container } = Harness('')
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('search')
  })

  it('exposes the searchbox ARIA role (matches Playwright getByRole expectations)', () => {
    Harness('')
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('uses the translated placeholder fallback', () => {
    Harness('')
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
  })

  it('honors a consumer-supplied placeholder over the i18n fallback', () => {
    Harness('', { placeholder: 'Find a customer' })
    expect(screen.getByPlaceholderText('Find a customer')).toBeInTheDocument()
  })

  it('does not render the clear button when value is empty', () => {
    Harness('')
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('renders the clear button when value is non-empty', () => {
    Harness('jan')
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('clicking the clear button calls onChange("") when no onClear is supplied', () => {
    const onChange = jest.fn()
    Harness('jan', { onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('clicking the clear button calls onClear instead of onChange when onClear is supplied', () => {
    const onChange = jest.fn()
    const onClear = jest.fn()
    Harness('jan', { onChange, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides the clear button when clearable=false even with non-empty value', () => {
    Harness('jan', { clearable: false })
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('hides the clear button when disabled', () => {
    Harness('jan', { disabled: true })
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('forwards typing to onChange', () => {
    const onChange = jest.fn()
    Harness('', { onChange })
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'kowalski' } })
    expect(onChange).toHaveBeenCalledWith('kowalski')
  })

  describe('shortcut slot', () => {
    it('renders a string shortcut inside a Kbd while the field is empty', () => {
      const { container } = Harness('', { shortcut: '⌘K' })
      const slot = container.querySelector('[data-slot="search-input-shortcut"]')
      expect(slot).not.toBeNull()
      expect(slot!.tagName).toBe('KBD')
      expect(slot).toHaveTextContent('⌘K')
    })

    it('renders a node shortcut verbatim', () => {
      const { container } = Harness('', { shortcut: <span data-testid="hint">⌘1</span> })
      expect(container.querySelector('[data-slot="search-input-shortcut"]')).not.toBeNull()
      expect(screen.getByTestId('hint')).toBeInTheDocument()
    })

    it('gives way to the clear button once there is something to clear', () => {
      const { container } = Harness('jan', { shortcut: '⌘K' })
      expect(container.querySelector('[data-slot="search-input-shortcut"]')).toBeNull()
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
    })

    it('reappears after the field is cleared', () => {
      const { container } = Harness('jan', { shortcut: '⌘K' })
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      expect(container.querySelector('[data-slot="search-input-shortcut"]')).not.toBeNull()
    })

    it('is suppressed while loading', () => {
      const { container } = Harness('', { shortcut: '⌘K', loading: true })
      expect(container.querySelector('[data-slot="search-input-shortcut"]')).toBeNull()
    })
  })

  describe('loading affordance', () => {
    it('suppresses the clear button so the trailing slot does not flicker mid-request', () => {
      Harness('jan', { loading: true })
      expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
    })

    it('leaves the field editable', () => {
      const onChange = jest.fn()
      Harness('ja', { loading: true, onChange })
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'jan' } })
      expect(onChange).toHaveBeenCalledWith('jan')
    })
  })

  describe('trailing slot', () => {
    it('renders alongside the clear button', () => {
      Harness('jan', { trailing: <span data-testid="scope">Org</span> })
      expect(screen.getByTestId('scope')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
    })
  })

  describe('tones', () => {
    const grounds: Array<[string, string]> = [
      ['default', 'bg-surface-muted'],
      ['raised', 'bg-surface'],
      ['sidebar', 'bg-sidebar-accent/50'],
      ['plain', 'bg-transparent'],
    ]

    it.each(grounds)('tone=%s paints its own ground (%s)', (tone, ground) => {
      const { container } = Harness('', { tone: tone as never })
      expect(wrapperOf(container).className).toContain(ground)
    })

    it.each(grounds)('tone=%s keeps the searchbox role', (tone) => {
      Harness('', { tone: tone as never })
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('never paints a resting border — the box is transparent so focus can add an edge without shifting', () => {
      const { container } = Harness('')
      expect(wrapperOf(container).className).toContain('border-transparent')
    })

    it('plain drops the padding and radius the popover header owns', () => {
      const { container } = Harness('', { tone: 'plain' })
      const className = wrapperOf(container).className
      expect(className).toContain('rounded-none')
      expect(className).toContain('px-0')
    })

    /* Regression: `raised` is the only tone with a resting drop shadow. Every
       Tailwind `shadow-*` writes the same `--tw-shadow` slot, so pairing it
       with `focus-within:shadow-focus` REPLACED the elevation and the field
       flattened on click. The halo must come from the ring slot instead. */
    it('raised keeps its elevation on focus — the halo is a ring, not a shadow', () => {
      const { container } = Harness('', { tone: 'raised' })
      const className = wrapperOf(container).className
      expect(className).toContain('shadow-md')
      expect(className).toContain('focus-within:ring-2')
      expect(className).not.toContain('focus-within:shadow-focus')
    })

    it('default gets the shared focus halo (it is flat, so nothing conflicts)', () => {
      const { container } = Harness('', { tone: 'default' })
      expect(wrapperOf(container).className).toContain('focus-within:shadow-focus')
    })

    it('sidebar paints a focus edge rather than a halo invisible on navy', () => {
      const { container } = Harness('', { tone: 'sidebar' })
      const className = wrapperOf(container).className
      expect(className).toContain('focus-within:border-sidebar-ring')
      expect(className).toContain('border-transparent')
    })

    /* Deliberate, not an oversight: `plain` is a popover header row that is
       always auto-focused and holds the only field, so the caret is the
       indicator — the command-palette convention. */
    it('plain carries no focus halo by design', () => {
      const { container } = Harness('', { tone: 'plain' })
      const className = wrapperOf(container).className
      expect(className).not.toContain('focus-within:shadow-focus')
      expect(className).not.toContain('focus-within:ring')
    })

    it('sidebar takes sidebar ink so the field is readable on the navy rail', () => {
      const { container } = Harness('', { tone: 'sidebar' })
      const input = container.querySelector('input') as HTMLInputElement
      expect(input.className).toContain('text-sidebar-foreground')
      expect(input.className).toContain('placeholder:text-sidebar-muted-foreground')
    })
  })

  describe('sizes', () => {
    it.each([
      ['sm', 'h-8'],
      ['default', 'h-9'],
      ['lg', 'h-10'],
    ])('size=%s sets the box height (%s)', (size, height) => {
      const { container } = Harness('', { size: size as never })
      expect(wrapperOf(container).className).toContain(height)
    })

    it('size=lg matches the sidebar rail grid (h-10 / px-3 / gap-3)', () => {
      const { container } = Harness('', { size: 'lg' })
      const className = wrapperOf(container).className
      expect(className).toContain('h-10')
      expect(className).toContain('px-3')
      expect(className).toContain('gap-3')
    })

    it('never fixes a width — the caller sizes the container', () => {
      const { container } = Harness('', { size: 'lg' })
      expect(wrapperOf(container).className).toContain('w-full')
    })
  })

  describe('click target', () => {
    it('pressing the padding focuses the input, not just the 16px of text cursor', () => {
      const { container } = Harness('')
      const input = container.querySelector('input') as HTMLInputElement
      expect(document.activeElement).not.toBe(input)
      fireEvent.mouseDown(wrapperOf(container))
      expect(document.activeElement).toBe(input)
    })

    /* The realistic miss: a press lands on the magnifier (or its <svg>), not on
       the wrapper. `closest()` must walk up from an SVG child and still let the
       focus through — an early return there would leave the glyph dead. */
    it('pressing the leading magnifier focuses the input', () => {
      const { container } = Harness('')
      const input = container.querySelector('input') as HTMLInputElement
      const svg = container.querySelector('[data-slot="search-input-wrapper"] svg') as Element
      expect(svg).not.toBeNull()
      fireEvent.mouseDown(svg, { bubbles: true })
      expect(document.activeElement).toBe(input)
    })

    it('leaves a press on the clear button alone', () => {
      const onClear = jest.fn()
      const { container } = Harness('jan', { onClear })
      const clear = screen.getByRole('button', { name: 'Clear search' })
      fireEvent.mouseDown(clear)
      fireEvent.click(clear)
      expect(onClear).toHaveBeenCalledTimes(1)
      expect(document.activeElement).not.toBe(container.querySelector('input'))
    })

    it('does not steal focus when disabled', () => {
      const { container } = Harness('', { disabled: true })
      fireEvent.mouseDown(wrapperOf(container))
      expect(document.activeElement).not.toBe(container.querySelector('input'))
    })
  })

  it('forwards the ref to the underlying input', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<SearchInput ref={ref} value="" onChange={() => {}} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.type).toBe('search')
  })

  it('forwards arbitrary input props (combobox pickers rely on this)', () => {
    render(
      <SearchInput
        value=""
        onChange={() => {}}
        role="combobox"
        aria-expanded
        aria-controls="listbox-1"
      />,
    )
    const combobox = screen.getByRole('combobox')
    expect(combobox).toHaveAttribute('aria-controls', 'listbox-1')
  })
})
