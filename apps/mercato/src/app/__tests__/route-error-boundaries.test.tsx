/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import BackendError from '../(backend)/backend/error'
import FrontendError from '../(frontend)/[...slug]/error'

// Regression: the app shipped with ZERO error.tsx files, so any throw bubbled to
// global-error.tsx, which renders its own <html>/<body> and replaced the whole
// document — nav rail, sidebar and header included.

function renderBoundary(
  Boundary: React.ComponentType<{ error: Error & { digest?: string }; reset: () => void }>,
  error: Error & { digest?: string },
  reset: () => void,
) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <Boundary error={error} reset={reset} />
    </I18nProvider>,
  )
}

describe.each([
  ['backend', BackendError],
  ['frontend', FrontendError],
])('%s route error boundary', (_name, Boundary) => {
  it('renders the shared ErrorMessage instead of tearing down the document', () => {
    renderBoundary(Boundary as never, new Error('internal detail'), () => {})

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    // It must render in place — never its own <html>, the way global-error does.
    expect(document.querySelectorAll('html')).toHaveLength(1)
  })

  it('never leaks the raw error message to the user', () => {
    renderBoundary(Boundary as never, new Error('SECRET internal detail'), () => {})
    expect(screen.queryByText(/SECRET internal detail/)).toBeNull()
  })

  it('shows the digest so support can correlate the failure', () => {
    const err = Object.assign(new Error('boom'), { digest: 'abc123' })
    renderBoundary(Boundary as never, err, () => {})
    expect(screen.getByText(/abc123/)).toBeInTheDocument()
  })

  it('calls reset() when the user retries', () => {
    const reset = jest.fn()
    renderBoundary(Boundary as never, new Error('boom'), reset)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
