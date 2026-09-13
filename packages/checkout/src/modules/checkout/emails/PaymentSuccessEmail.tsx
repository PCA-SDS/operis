import * as React from 'react'
import { Text } from '@react-email/components'
import { PaymentEmailLayout, paymentEmailStyles } from './PaymentEmailLayout'

export type PaymentSuccessEmailProps = {
  firstName: string
  amount: string
  currencyCode: string
  linkTitle: string
  transactionId: string
  bodyHtml?: string | null
  copy: {
    title: string
    preview: string
    greeting: string
    receipt: string
    hint: string
    transactionLabel: string
  }
}

export function PaymentSuccessEmail({ amount, currencyCode, transactionId, bodyHtml, copy }: PaymentSuccessEmailProps) {
  return (
    <PaymentEmailLayout title={copy.title} preview={copy.preview} hint={copy.hint} bodyHtml={bodyHtml}>
      <Text style={paymentEmailStyles.paragraph}>{copy.greeting}</Text>
      <Text style={paymentEmailStyles.amountSuccess}>{amount} {currencyCode}</Text>
      <Text style={paymentEmailStyles.mono}>{copy.transactionLabel}: {transactionId}</Text>
      <Text style={paymentEmailStyles.paragraph}>{copy.receipt}</Text>
    </PaymentEmailLayout>
  )
}

export default PaymentSuccessEmail
