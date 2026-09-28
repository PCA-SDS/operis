/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { FrontendLayout } from '../Layout'

jest.mock('../../backend/FlashMessages', () => ({
  FlashMessages: () => null,
}))

function HiddenFooter() {
  return null
}

describe('FrontendLayout', () => {
  it('adds nothing under the page when the footer renders nothing', () => {
    const { container } = render(
      <FrontendLayout footer={<HiddenFooter />}>
        <p>page</p>
      </FrontendLayout>,
    )
    const frame = container.firstElementChild as HTMLElement
    expect(frame.lastElementChild?.textContent).toBe('page')
    expect(container.querySelector('.border-t')).toBeNull()
  })

  it('leaves a shown footer to draw its own chrome', () => {
    const { container } = render(
      <FrontendLayout footer={<footer className="border-t">links</footer>}>
        <p>page</p>
      </FrontendLayout>,
    )
    const frame = container.firstElementChild as HTMLElement
    expect(frame.lastElementChild?.tagName).toBe('FOOTER')
    expect(container.querySelectorAll('.border-t')).toHaveLength(1)
  })
})
