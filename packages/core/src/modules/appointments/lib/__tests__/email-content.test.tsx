/** @jest-environment node */

import * as React from 'react'
import AppointmentNoti from '../../emails/AppointmentNoti'
import AppointmentConfirmationEmail from '../../emails/AppointmentConfirmationEmail'
import {
  CUSTOMER_APPOINTMENT_EMAIL_FONT_FAMILY,
  getAppointmentEmailCopyrightYear,
  INTERNAL_APPOINTMENT_EMAIL_FONT_FAMILY,
} from '../../emails/appointment-email'
import { DEFAULT_APPOINTMENT_EMAIL_SETTINGS } from '../email-settings'
import { APPOINTMENT_EMAIL_PREVIEW_DATA, buildAppointmentEmailContent } from '../email-content'

describe('appointment email content', () => {
  it('derives the copyright year from the current date', () => {
    expect(getAppointmentEmailCopyrightYear(new Date(2032, 5, 15))).toBe(2032)
  })

  it('returns the exact element trees from the legacy components', () => {
    const content = buildAppointmentEmailContent(APPOINTMENT_EMAIL_PREVIEW_DATA, DEFAULT_APPOINTMENT_EMAIL_SETTINGS)

    expect(content.internal.react).toEqual(AppointmentNoti(APPOINTMENT_EMAIL_PREVIEW_DATA))
    expect(content.customer.react).toEqual(AppointmentConfirmationEmail(APPOINTMENT_EMAIL_PREVIEW_DATA))
    expect(content.internal.subject).toBe('[TPS][BR] from Ms. Ruby Chou - Bến Thành')
    expect(content.customer.subject).toBe('Your booking has been recorded – The Privé Spa')
  })

  it('uses customized branding and subjects only in custom mode', () => {
    const settings = {
      ...DEFAULT_APPOINTMENT_EMAIL_SETTINGS,
      templateMode: 'custom' as const,
      customization: {
        ...DEFAULT_APPOINTMENT_EMAIL_SETTINGS.customization,
        brandName: 'Example Spa',
        internalSubjectPrefix: '[EXAMPLE] Booking from',
        customerSubject: 'We received your request',
      },
    }
    const content = buildAppointmentEmailContent(APPOINTMENT_EMAIL_PREVIEW_DATA, settings)
    const collectText = (node: unknown): string => {
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(collectText).join(' ')
      if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return ''
      return collectText(node.props.children)
    }
    type TestElement = React.ReactElement<{ children?: React.ReactNode; style?: React.CSSProperties }>
    const renderFunctionElement = (element: React.ReactElement): React.ReactElement => {
      if (typeof element.type !== 'function') throw new Error('[internal] Expected a function component')
      const component = element.type as (props: typeof element.props) => React.ReactElement
      return component(element.props)
    }
    const collectElements = (node: unknown, elements: TestElement[] = []): TestElement[] => {
      if (Array.isArray(node)) {
        node.forEach((child) => collectElements(child, elements))
        return elements
      }
      if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return elements
      elements.push(node)
      collectElements(node.props.children, elements)
      return elements
    }

    expect(content.internal.subject).toBe('[EXAMPLE] Booking from Ms. Ruby Chou - Bến Thành')
    expect(content.customer.subject).toBe('We received your request')
    const internalText = collectText(content.internal.react).replace(/\s+/g, ' ')
    const customerText = collectText(content.customer.react).replace(/\s+/g, ' ')
    expect(internalText).toContain('Example Spa Team')
    expect(internalText).toContain('made a booking at Example Spa on')
    expect(customerText).toContain('Thank you for choosing Example Spa')
    expect(customerText).toContain('Example Spa Booking Team')
    const customerElements = collectElements(content.customer.react)
    const bookingRequest = customerElements.find((element) => element.type === 'strong' && collectText(element) === 'booking request')
    const pendingEmphasis = customerElements.find((element) => element.type === 'strong' && collectText(element) === 'not yet been confirmed')
    const signOff = customerElements.find((element) => element.type === 'strong' && collectText(element) === 'Warm regards,')
    const customerFrameElements = collectElements(renderFunctionElement(content.customer.react))
    const internalFrameElements = collectElements(renderFunctionElement(content.internal.react))
    expect(customerFrameElements.some((element) => element.props.style?.fontFamily === CUSTOMER_APPOINTMENT_EMAIL_FONT_FAMILY)).toBe(true)
    expect(internalFrameElements.some((element) => element.props.style?.fontFamily === INTERNAL_APPOINTMENT_EMAIL_FONT_FAMILY)).toBe(true)
    expect(bookingRequest).toBeDefined()
    expect(signOff).toBeDefined()
    expect(pendingEmphasis?.props).toMatchObject({
      style: { color: '#c21c0b', textTransform: 'uppercase', textDecoration: 'underline' },
    })
  })
})
