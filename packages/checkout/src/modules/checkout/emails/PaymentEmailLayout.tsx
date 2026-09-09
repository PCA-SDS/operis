import * as React from 'react'
import { Html, Head, Preview, Body, Container, Text, Section, Hr } from '@react-email/components'
import { EmailFont, EMAIL_FONT_FAMILY, EMAIL_MONO_FONT_FAMILY } from '@open-mercato/shared/lib/email/typography'

/**
 * The shell every checkout payment email shares: page ground, card, title,
 * optional authored body, rule and hint footer.
 *
 * These are inline styles rather than design-system tokens on purpose — mail
 * clients do not support CSS custom properties, so the DS token rules do not
 * apply inside `emails/`. Keeping the palette in one place here is what stops
 * the three payment emails drifting apart.
 */
export const paymentEmailStyles = {
  body: { backgroundColor: '#f9fafb', margin: 0, padding: '24px 0', fontFamily: EMAIL_FONT_FAMILY } as React.CSSProperties,
  container: { backgroundColor: '#ffffff', borderRadius: 12, padding: 32, margin: '0 auto', maxWidth: 520, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as React.CSSProperties,
  title: { fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 12px' } as React.CSSProperties,
  errorTitle: { fontSize: 20, fontWeight: 600, color: '#dc2626', margin: '0 0 12px' } as React.CSSProperties,
  paragraph: { fontSize: 14, color: '#4b5563', lineHeight: '22px', margin: '0 0 16px' } as React.CSSProperties,
  amount: { fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 4px' } as React.CSSProperties,
  amountSuccess: { fontSize: 28, fontWeight: 700, color: '#16a34a', margin: '0 0 4px' } as React.CSSProperties,
  mono: { fontSize: 12, fontFamily: EMAIL_MONO_FONT_FAMILY, color: '#6b7280', margin: '0 0 16px' } as React.CSSProperties,
  hint: { fontSize: 12, color: '#9ca3af', margin: '16px 0 0' } as React.CSSProperties,
  rule: { borderColor: '#e5e7eb', margin: '24px 0' } as React.CSSProperties,
  errorBox: { backgroundColor: '#fef2f2', borderRadius: 8, padding: '12px 16px', margin: '0 0 16px' } as React.CSSProperties,
  errorText: { fontSize: 13, color: '#991b1b', margin: 0 } as React.CSSProperties,
}

export type PaymentEmailLayoutProps = {
  title: string
  preview: string
  hint: string
  /** Server-rendered, already-sanitized HTML. When present it replaces the default body. */
  bodyHtml?: string | null
  titleStyle?: React.CSSProperties
  children: React.ReactNode
}

export function PaymentEmailLayout({
  title,
  preview,
  hint,
  bodyHtml,
  titleStyle,
  children,
}: PaymentEmailLayoutProps) {
  return (
    <Html>
      <Head><title>{title}</title><EmailFont /></Head>
      <Preview>{preview}</Preview>
      <Body style={paymentEmailStyles.body}>
        <Container style={paymentEmailStyles.container}>
          <Section>
            <Text style={titleStyle ?? paymentEmailStyles.title}>{title}</Text>
            {bodyHtml ? (
              <div style={paymentEmailStyles.paragraph} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              children
            )}
            <Hr style={paymentEmailStyles.rule} />
            <Text style={paymentEmailStyles.hint}>{hint}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PaymentEmailLayout
