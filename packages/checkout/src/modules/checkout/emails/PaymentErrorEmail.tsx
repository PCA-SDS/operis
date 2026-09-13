import * as React from 'react'
import { Section, Text } from '@react-email/components'
import { PaymentEmailLayout, paymentEmailStyles } from './PaymentEmailLayout'

export type PaymentErrorEmailProps = {
  firstName: string
  linkTitle: string
  errorMessage?: string | null
  bodyHtml?: string | null
  copy: {
    title: string
    preview: string
    greeting: string
    retry: string
    hint: string
  }
}

export function PaymentErrorEmail({ errorMessage, bodyHtml, copy }: PaymentErrorEmailProps) {
  return (
    <PaymentEmailLayout
      title={copy.title}
      preview={copy.preview}
      hint={copy.hint}
      bodyHtml={bodyHtml}
      titleStyle={paymentEmailStyles.errorTitle}
    >
      <Text style={paymentEmailStyles.paragraph}>{copy.greeting}</Text>
      {errorMessage ? (
        <Section style={paymentEmailStyles.errorBox}>
          <Text style={paymentEmailStyles.errorText}>{errorMessage}</Text>
        </Section>
      ) : null}
      <Text style={paymentEmailStyles.paragraph}>{copy.retry}</Text>
    </PaymentEmailLayout>
  )
}

export default PaymentErrorEmail
