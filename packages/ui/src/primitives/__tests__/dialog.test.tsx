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

/** Matches one whole class, so `max-w-lg` is not found inside `max-sm:max-w-none`. */
function classToken(cls: string) {
  return new RegExp(`(^|\\s)${cls.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|$)`)
}

function ExampleDialog({
  size,
  dismissible,
  defaultOpen = true,
  footerLayout,
}: {
  size?: 'sm' | 'default' | 'lg' | 'xl'
  dismissible?: boolean
  defaultOpen?: boolean
  footerLayout?: 'default' | 'equal'
}) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent size={size} dismissible={dismissible}>
        <DialogHeader>
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

  it('default size="default" applies max-w-lg', () => {
    renderDialog(<ExampleDialog />)
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.getAttribute('data-size')).toBe('default')
    expect(content.className).toMatch(classToken('max-w-lg'))
  })

  it('size variants apply matching max-width', () => {
    const cases: Array<{ size: 'sm' | 'default' | 'lg' | 'xl'; cls: string }> = [
      { size: 'sm', cls: 'max-w-sm' },
      { size: 'default', cls: 'max-w-lg' },
      { size: 'lg', cls: 'max-w-2xl' },
      { size: 'xl', cls: 'max-w-4xl' },
    ]
    for (const { size, cls } of cases) {
      const { unmount } = renderDialog(<ExampleDialog size={size} />)
      const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
      expect(content.getAttribute('data-size')).toBe(size)
      expect(content.className).toMatch(classToken(cls))
      unmount()
    }
  })

  it('lets a plain size class from the caller size the desktop panel', () => {
    // The phone bottom sheet lives entirely under `max-sm:`, so a caller's
    // plain `max-w-*`, `h-*` or `top-*` is the desktop size it reads as. It
    // used to lose to the base's `sm:max-w-lg`, pinning every such dialog to
    // 512px whatever it asked for.
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent className="top-16 h-96 max-w-3xl translate-y-0">
          <DialogHeader>
            <DialogTitle>Wide</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    for (const cls of ['max-w-3xl', 'top-16', 'h-96', 'translate-y-0']) {
      expect(content.className).toMatch(classToken(cls))
    }
    for (const cls of ['max-w-lg', 'top-1/2', 'h-auto', '-translate-y-1/2']) {
      expect(content.className).not.toMatch(classToken(cls))
    }
    for (const cls of ['max-sm:inset-x-0', 'max-sm:bottom-0', 'max-sm:max-w-none', 'max-sm:rounded-b-none']) {
      expect(content.className).toMatch(classToken(cls))
    }
    expect(content.className).not.toMatch(/(^|\s)sm:max-w-/)
  })


  it('never renders a leading badge — modal headers carry no iconography', () => {
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
    // 20px above the buttons, and a bottom inset that matches the side inset:
    // 20px on a phone, 24px from sm.
    for (const cls of ['px-5', 'pt-5', 'pb-5', 'sm:px-6', 'sm:pb-6']) {
      expect(footer.className).toMatch(classToken(cls))
    }
  })

  it('lets the footer own the gap above it, so a scrolling body cannot crowd the buttons', () => {
    // A body that scrolls hides its own bottom padding at the end of the
    // scroll, which left the buttons 4px under the last visible field. The
    // body and header give up their bottom padding directly above a footer,
    // except above a bordered one, which keeps the body's padding over its rule.
    renderDialog(<DialogWithLooseBody />)
    const body = document.querySelector('[data-slot="dialog-body"]') as HTMLElement
    expect(body.className).toMatch(classToken('[&:has(+[data-slot$=footer]:not([data-bordered]))]:pb-0'))
    const header = document.querySelector('[data-slot="dialog-header"]') as HTMLElement
    expect(header.className).toMatch(classToken('[&:has(+[data-slot$=footer])]:pb-0'))
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



  // The three header-badge tests that used to sit here went with the feature:
  // `DialogHeader` no longer takes a `leading` icon or a `leadingTone`, because
  // modal headers in this product carry no iconography. Status/destructive
  // intent is signalled by the confirm button's variant and by the copy.

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
    expect(content.className).toMatch(classToken('max-w-2xl'))
  })
})

describe('Dialog — canonical borderless chrome', () => {
  it('overlay uses the theme-stable scrim token with no backdrop blur', () => {
    renderDialog(<ExampleDialog />)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement
    expect(overlay.className).toContain('bg-scrim')
    expect(overlay.className).not.toContain('backdrop-blur')
    expect(overlay.className).not.toContain('bg-black/40')
    // `bg-foreground/*` turns into a light veil in dark mode.
    expect(overlay.className).not.toContain('bg-foreground/')
  })

  it('panel is borderless with shadow-xl and owns no padding of its own', () => {
    renderDialog(<ExampleDialog />)
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.className).toContain('bg-surface')
    expect(content.className).toContain('shadow-xl')
    // 18px on every corner of the centred panel; the phone sheet squares off
    // only the edge that meets the bottom of the screen.
    expect(content.className).toMatch(classToken('rounded-2xl'))
    expect(content.className).toMatch(classToken('max-sm:rounded-b-none'))
    expect(content.className).not.toContain('shadow-2xl')
    expect(content.className).not.toMatch(/(^|\s)p-6(\s|$)/)
    expect(content.className).not.toMatch(/(^|\s)gap-4(\s|$)/)
  })

  it('header carries the insets, stays left-aligned, and ships no divider', () => {
    renderDialog(<ExampleDialog />)
    const header = document.querySelector('[data-slot="dialog-header"]') as HTMLElement
    // The top inset matches the side inset: 20px on a phone, 24px from sm.
    for (const cls of ['px-5', 'pt-5', 'pb-3', 'sm:px-6', 'sm:pt-6']) {
      expect(header.className).toMatch(classToken(cls))
    }
    expect(header.className).toContain('text-left')
    expect(header.className).not.toContain('text-center')
    expect(header.className).not.toContain('border-b')
  })

  it('title is the component-title step (text-lg) at every breakpoint', () => {
    renderDialog(<ExampleDialog />)
    const title = document.querySelector('[data-slot="dialog-title"]') as HTMLElement
    expect(title.className).toContain('text-lg')
    expect(title.className).toContain('font-semibold')
    expect(title.className).not.toContain('text-base')
    expect(title.className).not.toContain('text-xl')
  })

  it('close button is the shared filled circle, on the title line at the side inset', () => {
    renderDialog(<ExampleDialog />)
    const close = document.querySelector('[data-slot="dialog-close-button"]') as HTMLElement
    expect(close).not.toBeNull()
    for (const cls of ['rounded-full', 'bg-primary-soft', 'text-muted-foreground', 'h-7', 'w-7']) {
      expect(close.className).toMatch(classToken(cls))
    }
    expect(close.className).not.toContain('hover:scale-125')
    for (const cls of ['right-5', 'top-5', 'sm:right-6', 'sm:top-6']) {
      expect(close.className).toMatch(classToken(cls))
    }
  })

  it('header reserves the close-button gutter only when one renders', () => {
    const { unmount } = renderDialog(<ExampleDialog />)
    const header = document.querySelector('[data-slot="dialog-header"]') as HTMLElement
    expect(header.className).toMatch(classToken('pr-14'))
    expect(header.className).toMatch(classToken('sm:pr-15'))
    unmount()

    renderDialog(<ExampleDialog dismissible={false} />)
    expect(
      (document.querySelector('[data-slot="dialog-header"]') as HTMLElement).className,
    ).not.toMatch(classToken('pr-14'))
  })

  it('sizes the gutter and centres the close on the title line for each close size', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent closeSize="lg">
          <DialogHeader>
            <DialogTitle>Tall panel</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    const close = document.querySelector('[data-slot="dialog-close-button"]') as HTMLElement
    expect(close.className).toMatch(classToken('h-8'))
    expect(close.className).toMatch(classToken('top-4.5'))
    const header = document.querySelector('[data-slot="dialog-header"]') as HTMLElement
    expect(header.className).toMatch(classToken('pr-15'))
    expect(header.className).toMatch(classToken('sm:pr-16'))
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
    for (const cls of ['px-5', 'pt-3', 'pb-5', 'sm:px-6', 'sm:pb-6']) {
      expect(body.className).toMatch(classToken(cls))
    }
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
    expect(footer.className).toMatch(classToken('pt-5'))
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
