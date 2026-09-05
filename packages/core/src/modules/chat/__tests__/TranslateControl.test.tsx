/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TranslateControl } from '../components/TranslateControl'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(_key)
    if (!params) return text
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      text,
    )
  },
}))

function setup(overrides: Partial<React.ComponentProps<typeof TranslateControl>> = {}) {
  const onToggle = overrides.onToggle ?? jest.fn()
  const onLocaleChange = overrides.onLocaleChange ?? jest.fn()
  render(
    <TranslateControl
      locale="en"
      onLocaleChange={onLocaleChange}
      active={false}
      onToggle={onToggle}
      {...overrides}
    />,
  )
  return { onToggle, onLocaleChange }
}

describe('TranslateControl', () => {
  it('shows the language it will translate into, before it is pressed', () => {
    // The reader needs to know what "Translate" produces without trying it.
    setup({ locale: 'vi' })
    expect(screen.getByText('vi')).toBeTruthy()
  })

  it('turns whole-conversation mode on', () => {
    const { onToggle } = setup({ active: false })
    fireEvent.click(screen.getByRole('button', { name: /translate/i }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('offers the way back once it is on', () => {
    const { onToggle } = setup({ active: true })
    const back = screen.getByRole('button', { name: /show originals/i })
    fireEvent.click(back)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('reports progress rather than looking inert', () => {
    setup({ busy: true })
    expect(screen.getByText(/translating/i)).toBeTruthy()
  })

  it('is not pressable while a batch is in flight', () => {
    const { onToggle } = setup({ busy: true })
    fireEvent.click(screen.getByRole('button', { name: /translating/i }))
    expect(onToggle).not.toHaveBeenCalled()
  })

  describe('language picker', () => {
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: /choose translation language/i }))

    it('leads with the pairings this exists for, not the interface locales', () => {
      // French and Vietnamese have no interface translation and are exactly the
      // languages the feature was built for, so they must be reachable at once.
      setup()
      open()
      expect(screen.getByText('French')).toBeTruthy()
      expect(screen.getByText('Vietnamese')).toBeTruthy()
    })

    it('reaches any ISO-639-1 language by typing', () => {
      setup()
      open()
      fireEvent.change(screen.getByLabelText(/search languages/i), { target: { value: 'thai' } })
      expect(screen.getByText('Thai')).toBeTruthy()
    })

    it('matches on code as well as name', () => {
      setup()
      open()
      fireEvent.change(screen.getByLabelText(/search languages/i), { target: { value: 'sw' } })
      expect(screen.getByText('Swahili')).toBeTruthy()
    })

    it('says so when nothing matches, rather than showing an empty list', () => {
      setup()
      open()
      fireEvent.change(screen.getByLabelText(/search languages/i), { target: { value: 'zzzz' } })
      expect(screen.getByText(/no language matches/i)).toBeTruthy()
    })

    it('reports the chosen language and closes', () => {
      const { onLocaleChange } = setup()
      open()
      fireEvent.click(screen.getByText('Vietnamese'))
      expect(onLocaleChange).toHaveBeenCalledWith('vi')
    })

    it('explains that this is not the interface language', () => {
      // The whole reason the setting exists; without saying so it reads as a
      // duplicate of the profile menu's Language.
      setup()
      open()
      expect(screen.getByText(/separate from your interface language/i)).toBeTruthy()
    })
  })
})
