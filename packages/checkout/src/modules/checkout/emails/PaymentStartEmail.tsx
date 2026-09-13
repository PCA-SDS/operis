import * as React from 'react'
import { Text } from '@react-email/components'
import { PaymentEmailLayout, paymentEmailStyles } from './PaymentEmailLayout'

export type PaymentStartEmailProps = {
  firstName: string
  amount: string
  currencyCode: string
  linkTitle: string
  bodyHtml?: string | null
  copy: {
    title: string
    preview: string
    greeting: string
    message: string
    hint: string
  }
}

export function PaymentStartEmail({ amount, currencyCode, bodyHtml, copy }: PaymentStartEmailProps) {
  return (
    <PaymentEmailLayout title={copy.title} preview={copy.preview} hint={copy.hint} bodyHtml={bodyHtml}>
      <Text style={paymentEmailStyles.paragraph}>{copy.greeting}</Text>
      <Text style={paymentEmailStyles.amount}>{amount} {currencyCode}</Text>
      <Text style={paymentEmailStyles.paragraph}>{copy.message}</Text>
    </PaymentEmailLayout>
  )
}

export default PaymentStartEmail
