/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
  DialogClose,
} from '../dialog'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

function renderDialog(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" dict={{ ui: { dialog: { close: { ariaLabel: 'Close' } } } }}>
      {ui}
    </I18nProvider>,
  )
}

function ExampleDialog({
  size,
  dismissible,
  defaultOpen = true,
  leading,
  footerLayout,
}: {
  size?: 'sm' | 'default' | 'lg' | 'xl'
  dismissible?: boolean
  defaultOpen?: boolean
  leading?: React.ReactNode
  footerLayout?: 'default' | 'equal'
}) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent size={size} dismissible={dismissible}>
        <DialogHeader leading={leading}>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>This dialog confirms a critical action.</DialogDescription>
        </DialogHeader>
        <DialogFooter layout={footerLayout}>
          <DialogClose>Cancel</DialogClose>
          <button>Continue</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog (Phase B.7)', () => {
  it('renders content / overlay / header / title / description / footer slots inside a Radix Dialog', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-title"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-description"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-footer"]')).not.toBeNull()
  })

  it('opens on trigger click when defaultOpen=false', () => {
    function Controlled() {
      const [open, setOpen] = React.useState(false)
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
    }
    renderDialog(<Controlled />)
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    fireEvent.click(screen.getByText('Open'))
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
  })

  it('renders the auto X close button by default', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-close-button"]')).not.toBeNull()
  })

  it('omits the auto X when dismissible=false', () => {
    renderDialog(<ExampleDialog dismissible={false} />)
    expect(document.querySelector('[data-slot="dialog-close-button"]')).toBeNull()
  })

  it('default size="default" applies sm:max-w-lg', () => {
    renderDialog(<ExampleDialog />)
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.getAttribute('data-size')).toBe('default')
    expect(content.className).toContain('sm:max-w-lg')
  })

  it('size variants apply matching max-width', () => {
    const cases: Array<{ size: 'sm' | 'default' | 'lg' | 'xl'; cls: string }> = [
      { size: 'sm', cls: 'sm:max-w-sm' },
      { size: 'default', cls: 'sm:max-w-lg' },
      { size: 'lg', cls: 'sm:max-w-2xl' },
      { size: 'xl', cls: 'sm:max-w-4xl' },
    ]
    for (const { size, cls } of cases) {
      const { unmount } = renderDialog(<ExampleDialog size={size} />)
      const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
      expect(content.getAttribute('data-size')).toBe(size)
      expect(content.className).toContain(cls)
      unmount()
    }
  })

  it('renders the header leading badge when leading is provided', () => {
    renderDialog(<ExampleDialog leading={<span data-testid="lead-icon">⚙</span>} />)
    const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.querySelector('[data-testid="lead-icon"]')).not.toBeNull()
    expect(badge.className).toContain('rounded-full')
    expect(badge.className).toContain('size-7')
    expect(badge.className).toContain('border')
    // Title + description live inside the text wrapper alongside the badge.
    const text = document.querySelector('[data-slot="dialog-header-text"]') as HTMLElement
    expect(text).not.toBeNull()
    expect(text.querySelector('[data-slot="dialog-title"]')).not.toBeNull()
    expect(text.querySelector('[data-slot="dialog-description"]')).not.toBeNull()
  })

  it('omits the leading badge by default', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-header-leading"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-header-text"]')).toBeNull()
  })

  it('default footer layout reads "default" + flex-col-reverse classes', () => {
    renderDialog(<ExampleDialog />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('default')
    expect(footer.className).toContain('flex-col-reverse')
    expect(footer.className).toContain('sm:justify-end')
  })

  it('footer is borderless by default and takes its rhythm from the padding trio', () => {
    renderDialog(<ExampleDialog />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-bordered')).toBeNull()
    expect(footer.className).not.toContain('border-t')
    expect(footer.className).toContain('px-5')
    expect(footer.className).toContain('pt-1.5')
    expect(footer.className).toContain('pb-4')
    expect(footer.className).toContain('sm:px-6')
  })

  it('footer bordered=true opts a long scrolling body back into a separator', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <DialogFooter bordered>
            <DialogClose>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-bordered')).toBe('true')
    expect(footer.className).toContain('border-t')
  })

  it('footer layout="equal" stretches children flex-1', () => {
    renderDialog(<ExampleDialog footerLayout="equal" />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('equal')
    expect(footer.className).toContain('[&>*]:flex-1')
    expect(footer.className).not.toContain('flex-col-reverse')
    // Borderless chrome applies to the equal layout too.
    expect(footer.className).not.toContain('border-t')
  })

  it('footer leading slot renders left content + right-aligned trailing buttons per Figma `Modal Footer [1.1]` variants 2-6', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <DialogFooter leading={<label data-testid="dont-show">Don&apos;t show again</label>}>
            <DialogClose>Cancel</DialogClose>
            <button>Continue</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const leading = document.querySelector('[data-slot="dialog-footer-leading"]') as HTMLElement
    expect(leading).not.toBeNull()
    expect(leading.className).toContain('sm:mr-auto')
    expect(leading.querySelector('[data-testid="dont-show"]')).not.toBeNull()
    const trailing = document.querySelector('[data-slot="dialog-footer-trailing"]') as HTMLElement
    expect(trailing).not.toBeNull()
    // Footer wraps as flex with leading mr-auto pushing trailing to the right.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.className).not.toContain('border-t')
    expect(footer.className).not.toContain('justify-end')
  })

  it('header leadingTone defaults to "default" with bordered white badge', () => {
    renderDialog(<ExampleDialog leading={<span>x</span>} />)
    const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
    expect(badge.getAttribute('data-tone')).toBe('default')
    expect(badge.className).toContain('border')
    expect(badge.className).toContain('border-border')
    expect(badge.className).toContain('bg-surface')
  })

  it('header leadingTone applies soft status tint + colored icon per Figma `Status Modals [1.1]`', () => {
    const cases: Array<{
      tone: 'accent' | 'success' | 'warning' | 'error' | 'info'
      bg: string
      tx: string
    }> = [
      // Canonical Figma Status Modals — soft tint background paired
      // with a saturated colored icon (red `!` on light pink, etc.).
      { tone: 'accent', bg: 'bg-accent-strong/10', tx: 'text-accent-strong' },
      { tone: 'success', bg: 'bg-status-success-bg', tx: 'text-status-success-icon' },
      { tone: 'warning', bg: 'bg-status-warning-bg', tx: 'text-status-warning-icon' },
      { tone: 'error', bg: 'bg-status-error-bg', tx: 'text-status-error-icon' },
      { tone: 'info', bg: 'bg-status-info-bg', tx: 'text-status-info-icon' },
    ]
    for (const { tone, bg, tx } of cases) {
      const { unmount } = renderDialog(
        <Dialog defaultOpen>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader leading={<span>x</span>} leadingTone={tone}>
              <DialogTitle>t</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      )
      const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
      expect(badge.getAttribute('data-tone')).toBe(tone)
      expect(badge.className).toContain(bg)
      expect(badge.className).toContain(tx)
      // Status tones drop the bordered white shell.
      expect(badge.className).not.toContain('border-input')
      unmount()
    }
  })

  it('Radix Dialog ARIA contract: role="dialog", labelledby/describedby from Title + Description', () => {
    renderDialog(<ExampleDialog />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const labelledBy = dialog.getAttribute('aria-labelledby')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Confirm action')
  })

  it('DialogClose dismisses the dialog when clicked', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
    fireEvent.click(screen.getByText('Cancel'))
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })

  it('forwards className to DialogContent without dropping size classes', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent className="custom-class" size="lg">
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.className).toContain('custom-class')
    expect(content.className).toContain('sm:max-w-2xl')
  })
})

describe('Dialog — canonical borderless chrome', () => {
  it('overlay uses the foreground scrim with no backdrop blur', () => {
    renderDialog(<ExampleDialog />)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement
    expect(overlay.className).toContain('bg-foreground/40')
    expect(overlay.className).not.toContain('backdrop-blur')
    expect(overlay.className).not.toContain('bg-black/40')
  })

  it('panel is borderless with shadow-xl and owns no padding of its own', () => {
    renderDialog(<ExampleDialog />)
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.className).toContain('bg-surface')
    expect(content.className).toContain('shadow-xl')
    expect(content.className).toContain('rounded-t-2xl')
    expect(content.className).toContain('sm:rounded-2xl')
    expect(content.className).not.toContain('shadow-2xl')
    expect(content.className).not.toMatch(/(^|\s)p-6(\s|$)/)
    expect(content.className).not.toMatch(/(^|\s)gap-4(\s|$)/)
  })

  it('header carries the padding pair, stays left-aligned, and ships no divider', () => {
    renderDialog(<ExampleDialog />)
    const header = document.querySelector('[data-slot="dialog-header"]') as HTMLElement
    expect(header.className).toContain('px-5')
    expect(header.className).toContain('py-4')
    expect(header.className).toContain('sm:px-6')
    expect(header.className).toContain('text-left')
    expect(header.className).not.toContain('text-center')
    expect(header.className).not.toContain('border-b')
  })

  it('title is text-xl at every breakpoint', () => {
    renderDialog(<ExampleDialog />)
    const title = document.querySelector('[data-slot="dialog-title"]') as HTMLElement
    expect(title.className).toContain('text-xl')
    expect(title.className).toContain('font-semibold')
    expect(title.className).not.toContain('text-base')
  })

  it('close button is the shared CloseButton affordance, not a bare icon', () => {
    renderDialog(<ExampleDialog />)
    const close = document.querySelector('[data-slot="dialog-close-button"]') as HTMLElement
    expect(close).not.toBeNull()
    expect(close.className).toContain('text-disabled-foreground')
    expect(close.className).toContain('hover:scale-125')
    expect(close.className).toContain('h-7')
    expect(close.className).toContain('w-7')
  })

  it('header reserves the close-button gutter only when one renders', () => {
    const { unmount } = renderDialog(<ExampleDialog />)
    expect(
      (document.querySelector('[data-slot="dialog-header"]') as HTMLElement).className,
    ).toContain('pr-11')
    unmount()

    renderDialog(<ExampleDialog dismissible={false} />)
    expect(
      (document.querySelector('[data-slot="dialog-header"]') as HTMLElement).className,
    ).not.toContain('pr-11')
  })
})

function DialogWithLooseBody() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename view</DialogTitle>
        </DialogHeader>
        <p>Press Escape or click outside to dismiss.</p>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog — DialogBody auto-wrap', () => {
  it('groups loose children into a DialogBody carrying the body padding', () => {
    renderDialog(<DialogWithLooseBody />)
    const body = document.querySelector('[data-slot="dialog-body"]') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.className).toContain('px-5')
    expect(body.className).toContain('pt-3')
    expect(body.className).toContain('pb-5')
    expect(body.className).toContain('sm:px-6')
    expect(body.textContent).toContain('Press Escape')
  })

  it('leaves header and footer outside the generated body', () => {
    renderDialog(<DialogWithLooseBody />)
    const body = document.querySelector('[data-slot="dialog-body"]') as HTMLElement
    expect(body.querySelector('[data-slot="dialog-header"]')).toBeNull()
    expect(body.querySelector('[data-slot="dialog-footer"]')).toBeNull()
  })

  it('emits no body slot when a dialog is header + footer only', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-body"]')).toBeNull()
  })

  it('does not double-wrap an explicit DialogBody', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <DialogBody className="custom-body">content</DialogBody>
        </DialogContent>
      </Dialog>,
    )
    const bodies = document.querySelectorAll('[data-slot="dialog-body"]')
    expect(bodies).toHaveLength(1)
    expect((bodies[0] as HTMLElement).className).toContain('custom-body')
  })

  it('descends into a form wrapper so a nested footer keeps footer padding', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <form>
            <p>field</p>
            <DialogFooter>
              <button>Save</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    )
    const form = document.querySelector('form') as HTMLElement
    const body = form.querySelector('[data-slot="dialog-body"]') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.textContent).toContain('field')
    // The footer is a sibling of the generated body, not swallowed by it.
    const footer = form.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer).not.toBeNull()
    expect(body.contains(footer)).toBe(false)
    expect(footer.className).toContain('pt-1.5')
  })

  it('disableBodyWrap renders children verbatim for full-bleed panels', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent disableBodyWrap>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <div data-testid="bleed">edge to edge</div>
        </DialogContent>
      </Dialog>,
    )
    expect(document.querySelector('[data-slot="dialog-body"]')).toBeNull()
    expect(screen.getByTestId('bleed')).toBeInTheDocument()
  })
})
