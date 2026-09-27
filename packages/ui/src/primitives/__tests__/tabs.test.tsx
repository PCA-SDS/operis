import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { Tabs, TabsContent, TabsContext, TabsList, TabsPanel, TabsTrigger } from '../tabs'

type Box = { left: number; top: number; width: number; height: number }

function rect({ left, top, width, height }: Box): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

type AnimateCall = { node: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: jest.Mock }

function installAnimate() {
  const calls: AnimateCall[] = []
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: function animate(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const cancel = jest.fn()
      calls.push({ node: this, keyframes, options, cancel })
      return { cancel } as unknown as Animation
    },
  })
  return calls
}

function uninstallAnimate() {
  delete (HTMLElement.prototype as { animate?: unknown }).animate
}

const tabBoxes: Record<string, Box> = {
  Alpha: { left: 100, top: 60, width: 80, height: 2 },
  Beta: { left: 196, top: 60, width: 60, height: 2 },
  Gamma: { left: 272, top: 60, width: 120, height: 2 },
}

function stubGeometry() {
  return jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.slot === 'tabs-list') return rect({ left: 100, top: 25, width: 600, height: 40 })
    if (this.dataset.slot === 'tabs-indicator') {
      const label = this.closest('[role="tab"]')?.textContent ?? ''
      const box = tabBoxes[label]
      if (box) return rect(box)
    }
    return rect({ left: 0, top: 0, width: 0, height: 0 })
  })
}

function Strip({ initial = 'a', onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = React.useState(initial)
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    >
      <TabsList aria-label="Sections">
        <TabsTrigger value="a">Alpha</TabsTrigger>
        <TabsTrigger value="b">Beta</TabsTrigger>
        <TabsTrigger value="c">Gamma</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Alpha panel</TabsContent>
      <TabsContent value="b">Beta panel</TabsContent>
      <TabsContent value="c">Gamma panel</TabsContent>
    </Tabs>
  )
}

function indicatorOf(tab: HTMLElement): HTMLElement {
  return tab.querySelector('[data-slot="tabs-indicator"]') as HTMLElement
}

describe('Tabs context provider', () => {
  it('keeps a stable context value reference across unrelated parent re-renders', () => {
    const captured: unknown[] = []

    function Capture() {
      captured.push(React.useContext(TabsContext))
      return null
    }

    function Host() {
      const [n, setN] = React.useState(0)
      return (
        <Tabs defaultValue="a">
          <button type="button" onClick={() => setN((prev) => prev + 1)}>
            bump {n}
          </button>
          <Capture />
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">A content</TabsContent>
        </Tabs>
      )
    }

    const { getByRole } = render(<Host />)
    const initial = captured[captured.length - 1]

    fireEvent.click(getByRole('button', { name: /bump/ }))
    fireEvent.click(getByRole('button', { name: /bump/ }))
    expect(getByRole('button', { name: /bump/ }).textContent).toBe('bump 2')

    const afterUnrelated = captured[captured.length - 1]
    expect(afterUnrelated).toBe(initial)
  })

  it('produces a new context value reference when the selected tab changes', () => {
    const captured: unknown[] = []

    function Capture() {
      captured.push(React.useContext(TabsContext))
      return null
    }

    const { getByRole } = render(
      <Tabs defaultValue="a">
        <Capture />
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A content</TabsContent>
        <TabsContent value="b">B content</TabsContent>
      </Tabs>,
    )

    const before = captured[captured.length - 1]
    fireEvent.click(getByRole('tab', { name: 'B' }))
    const after = captured[captured.length - 1]

    expect(after).not.toBe(before)
  })
})

describe('Tabs look', () => {
  it('draws one strip: full width, a hairline rail, tabs sitting on it, wrapping when out of room', () => {
    const { container } = render(<Strip />)
    const root = container.querySelector('[data-slot="tabs"]') as HTMLElement
    expect(root.getAttribute('data-orientation')).toBe('horizontal')
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    const classes = list.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'w-full', 'min-h-10', 'items-end', 'gap-4', 'border-b', 'border-border']))
    expect(classes).not.toContain('bg-muted')
    expect(list.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('sets every tab in one weight and shows the selection in ink, never a fill', () => {
    const { getAllByRole } = render(<Strip />)
    const [alpha, beta] = getAllByRole('tab')
    for (const tab of getAllByRole('tab')) {
      expect(tab.className).toContain('font-medium')
      expect(tab.className).not.toContain('font-semibold')
      expect(tab.className).toContain('h-9')
      expect(tab.className).not.toMatch(/(^|\s)(hover:)?bg-/)
    }
    expect(alpha.className).toContain('text-foreground')
    expect(beta.className).toContain('text-muted-foreground')
    expect(beta.className).toContain('hover:text-foreground')
  })

  it('shows the accent bar under the selected tab only', () => {
    const { getAllByRole } = render(<Strip initial="b" />)
    const [alpha, beta, gamma] = getAllByRole('tab')
    expect(indicatorOf(beta).className).toContain('opacity-100')
    expect(indicatorOf(beta).className).toContain('bg-accent-strong')
    expect(indicatorOf(beta).className).toContain('origin-top-left')
    expect(indicatorOf(alpha).className).toContain('opacity-0')
    expect(indicatorOf(gamma).className).toContain('opacity-0')
    expect(indicatorOf(beta).getAttribute('aria-hidden')).toBe('true')
  })

  it('stacks a vertical strip and shows the selection as a quiet fill', () => {
    const { container, getAllByRole } = render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const root = container.querySelector('[data-slot="tabs"]') as HTMLElement
    expect(root.getAttribute('data-orientation')).toBe('vertical')
    expect(root.className).toContain('gap-4')
    const list = container.querySelector('[data-slot="tabs-list"]') as HTMLElement
    expect(list.className).toContain('flex-col')
    expect(list.getAttribute('aria-orientation')).toBe('vertical')
    const [a, b] = getAllByRole('tab')
    expect(indicatorOf(a).className).toContain('bg-surface-muted')
    expect(indicatorOf(a).className).toContain('opacity-100')
    expect(indicatorOf(b).className).toContain('opacity-0')
  })

  it('renders the leading icon in the tab ink', () => {
    const Icon = () => <svg data-testid="lead" />
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" leading={<Icon />}>A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const leading = container.querySelector('[data-slot="tabs-trigger-leading"]') as HTMLElement
    expect(leading).not.toBeNull()
    expect(leading.className).not.toMatch(/text-/)
    expect(container.querySelector('[data-testid="lead"]')).not.toBeNull()
  })

  it('sets a count as a quiet number after the label in every state', () => {
    const { container, getAllByRole } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" count={5}>Active</TabsTrigger>
          <TabsTrigger value="b" count={3}>Inactive</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const counts = Array.from(container.querySelectorAll('[data-slot="tabs-trigger-count"]')) as HTMLElement[]
    expect(counts.map((count) => count.textContent)).toEqual(['5', '3'])
    for (const count of counts) {
      expect(count.className).toContain('tabular-nums')
      expect(count.className).toContain('text-muted-foreground')
      expect(count.className).not.toMatch(/(^|\s)bg-/)
    }
    expect(getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Active5', 'Inactive3'])
  })

  it('renders a zero count and omits a missing one', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" count={0}>Empty</TabsTrigger>
          <TabsTrigger value="b">No count</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const counts = container.querySelectorAll('[data-slot="tabs-trigger-count"]')
    expect(counts).toHaveLength(1)
    expect(counts[0].textContent).toBe('0')
  })

  it('accepts the deprecated variant prop without changing the markup', () => {
    const { container: plain } = render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs>)
    const { container: legacy } = render(
      <Tabs defaultValue="a" variant="underline"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs>,
    )
    expect(legacy.innerHTML).toBe(plain.innerHTML)
  })
})

describe('Tabs motion', () => {
  let calls: AnimateCall[]
  let geometry: jest.SpyInstance

  beforeEach(() => {
    calls = installAnimate()
    geometry = stubGeometry()
  })

  afterEach(() => {
    geometry.mockRestore()
    uninstallAnimate()
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('does not animate on the first render', () => {
    render(<Strip />)
    expect(calls).toHaveLength(0)
  })

  it('glides the bar from the old tab to the new one on the panel curve', () => {
    const { getByRole } = render(<Strip />)
    fireEvent.click(getByRole('tab', { name: 'Gamma' }))
    const glide = calls.find((call) => call.node.dataset.slot === 'tabs-indicator')
    expect(glide).toBeDefined()
    expect(glide?.node).toBe(indicatorOf(getByRole('tab', { name: 'Gamma' })))
    expect(glide?.keyframes).toEqual([
      { transform: 'translate(-172px, 0px) scale(0.6666666666666666, 1)' },
      { transform: 'none' },
    ])
    expect(glide?.options).toEqual({ duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })
  })

  it('fades the new panel in and leaves the first one alone', () => {
    const { getByRole, getByText } = render(<Strip />)
    fireEvent.click(getByRole('tab', { name: 'Beta' }))
    const fade = calls.find((call) => call.node.dataset.slot === 'tabs-content')
    expect(fade?.node).toBe(getByText('Beta panel'))
    expect(fade?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(fade?.options).toEqual({ duration: 150, easing: 'ease-out' })
  })

  it('cancels a glide that a second change interrupts', () => {
    const { getByRole } = render(<Strip />)
    fireEvent.click(getByRole('tab', { name: 'Beta' }))
    const first = calls.find((call) => call.node.dataset.slot === 'tabs-indicator')
    fireEvent.click(getByRole('tab', { name: 'Gamma' }))
    expect(first?.cancel).toHaveBeenCalled()
    const glides = calls.filter((call) => call.node.dataset.slot === 'tabs-indicator')
    expect(glides).toHaveLength(2)
    expect(glides[1].node).toBe(indicatorOf(getByRole('tab', { name: 'Gamma' })))
  })

  it('glides from where the bar last rested when the old tab left the strip', () => {
    function Shrinking() {
      const [value, setValue] = React.useState('a')
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabsList>
            {value === 'a' ? <TabsTrigger value="a">Alpha</TabsTrigger> : null}
            <TabsTrigger value="b">Beta</TabsTrigger>
          </TabsList>
        </Tabs>
      )
    }
    const { getByRole } = render(<Shrinking />)
    fireEvent.click(getByRole('tab', { name: 'Beta' }))
    const glide = calls.find((call) => call.node.dataset.slot === 'tabs-indicator')
    expect(glide?.keyframes[0]).toEqual({ transform: 'translate(-96px, 0px) scale(1.3333333333333333, 1)' })
  })

  it('makes both changes instant under reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    })
    const { getByRole } = render(<Strip />)
    fireEvent.click(getByRole('tab', { name: 'Gamma' }))
    expect(calls).toHaveLength(0)
    expect(indicatorOf(getByRole('tab', { name: 'Gamma' })).className).toContain('opacity-100')
  })
})

describe('Tabs keyboard', () => {
  function renderStrip() {
    const onChange = jest.fn()
    const utils = render(
      <Tabs defaultValue="a" onValueChange={onChange}>
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b" disabled>Beta</TabsTrigger>
          <TabsTrigger value="c">Gamma</TabsTrigger>
          <TabsTrigger value="d">Delta</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    return { ...utils, onChange }
  }

  it('moves focus with the arrow keys, skipping disabled tabs and wrapping at the ends', () => {
    const { getByRole, onChange } = renderStrip()
    const alpha = getByRole('tab', { name: 'Alpha' })
    alpha.focus()
    fireEvent.keyDown(alpha, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'Gamma' }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'Delta' }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(alpha)
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'Delta' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('jumps to the first and last tab with Home and End', () => {
    const { getByRole } = renderStrip()
    const gamma = getByRole('tab', { name: 'Gamma' })
    gamma.focus()
    fireEvent.keyDown(gamma, { key: 'End' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'Delta' }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    expect(document.activeElement).toBe(getByRole('tab', { name: 'Alpha' }))
  })

  it('keeps every tab in the tab order', () => {
    const { getAllByRole } = renderStrip()
    for (const tab of getAllByRole('tab')) expect(tab.getAttribute('tabindex')).toBeNull()
  })
})

describe('TabsPanel', () => {
  let calls: AnimateCall[]

  beforeEach(() => {
    calls = installAnimate()
  })

  afterEach(() => {
    uninstallAnimate()
  })

  function Counter() {
    const [count, setCount] = React.useState(0)
    return (
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        clicked {count}
      </button>
    )
  }

  it('fades in on each change after the first render and keeps its content mounted', () => {
    const { getByRole, rerender } = render(
      <TabsPanel value="a" className="pt-6">
        <Counter />
      </TabsPanel>,
    )
    const panel = getByRole('tabpanel')
    expect(panel.className).toBe('pt-6')
    expect(calls).toHaveLength(0)
    fireEvent.click(getByRole('button'))
    rerender(
      <TabsPanel value="b" className="pt-6">
        <Counter />
      </TabsPanel>,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].node).toBe(panel)
    expect(calls[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(getByRole('button').textContent).toBe('clicked 1')
    rerender(
      <TabsPanel value="b" className="pt-6">
        <Counter />
      </TabsPanel>,
    )
    expect(calls).toHaveLength(1)
  })
})
