import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'
import * as React from 'react'
import {
  DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION,
  type AppointmentEmailCustomization,
} from '../lib/email-settings'
import {
  buildCartItems,
  calculateCartTotal,
  CUSTOMER_APPOINTMENT_EMAIL_FONT_FAMILY,
  formatBookingDate,
  formatBookingTime,
  getAppointmentEmailCopyrightYear,
  INTERNAL_APPOINTMENT_EMAIL_FONT_FAMILY,
  type AppointmentEmailData,
  type CartItem,
  type Price,
} from './appointment-email'

type CustomAppointmentEmailProps = {
  data: AppointmentEmailData
  customization: AppointmentEmailCustomization
}

type EmailAudience = 'internal' | 'customer'

const locationNames: Record<string, string> = {
  benThanh: 'Ben Thanh',
  thaoDien: 'Thao Dien',
  phuMyHung: 'Phu My Hung',
  hoanKiem: 'Hoan Kiem',
}

const membershipBadgeStyles: Record<string, { backgroundColor: string; color: string; borderColor: string }> = {
  gold: { backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fde68a' },
  silver: { backgroundColor: '#f1f5f9', color: '#1e293b', borderColor: '#e2e8f0' },
  expat: { backgroundColor: '#d1fae5', color: '#065f46', borderColor: '#a7f3d0' },
}

function usesOriginalPalette(customization: AppointmentEmailCustomization): boolean {
  return customization.accentColor.toLowerCase() === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.accentColor.toLowerCase()
}

function resolveEmailColors(customization: AppointmentEmailCustomization, audience: EmailAudience) {
  if (usesOriginalPalette(customization)) {
    return audience === 'internal'
      ? {
          background: '#e8f3ed',
          header: '#1e4d2b',
          headerText: '#cccccc',
          panel: '#f0f7f3',
          panelBorder: '#2d5f3f',
          text: '#3d5a4a',
          footer: '#f0f7f3',
        }
      : {
          background: '#eef4f1',
          header: customization.accentColor,
          headerText: '#ffffff',
          panel: '#eef4f1',
          panelBorder: '#3d5a4a',
          text: '#3d5a4a',
          footer: '#eef4f1',
        }
  }

  return {
    background: mixWithWhite(customization.accentColor, 0.91),
    header: customization.accentColor,
    headerText: '#ffffff',
    panel: mixWithWhite(customization.accentColor, 0.91),
    panelBorder: customization.accentColor,
    text: customization.accentColor,
    footer: mixWithWhite(customization.accentColor, 0.91),
  }
}

function mixWithWhite(color: string, whiteRatio: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
  return `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * whiteRatio)).join(', ')})`
}

function resolveCart(data: AppointmentEmailData): { items: CartItem[]; total: Price } {
  const items = buildCartItems(data.serviceSelections ?? [], undefined, true)
  return { items, total: calculateCartTotal(items) }
}

function formatPrice(price: Price): string {
  return typeof price === 'number'
    ? `${price.toLocaleString('vi-VN')} VND`
    : `${price.min.toLocaleString('vi-VN')} - ${price.max.toLocaleString('vi-VN')} VND`
}

function MultilineText({ value }: { value: string }) {
  const lines = value.split('\n')
  return (
    <>
      {lines.map((line, index) => (
        <React.Fragment key={`${line}-${index}`}>
          {index > 0 ? <br /> : null}
          {line}
        </React.Fragment>
      ))}
    </>
  )
}

function MembershipValue({ membership }: { membership?: string | null }) {
  if (!membership || membership === 'none') return <>Not Yet</>

  const badgeColors = membershipBadgeStyles[membership.toLowerCase()] ?? {
    backgroundColor: '#2d5f3f',
    color: '#ffffff',
    borderColor: '#2d5f3f',
  }
  return (
    <span style={{ ...sharedStyles.membershipBadge, ...badgeColors }}>
      {membership}
    </span>
  )
}

function BookingDetails({
  data,
  accentColor,
  audience,
}: {
  data: AppointmentEmailData
  accentColor: string
  audience: EmailAudience
}) {
  const displayName = `${data.salutation || 'Mr'}. ${data.customerName}`
  const rows: Array<[string, React.ReactNode]> = [
    [audience === 'internal' ? 'Guest Name:' : 'Name:', displayName],
    ['Membership:', <MembershipValue key="membership" membership={data.membership} />],
    ['Zalo / WhatsApp:', `${data.countryCode} ${data.customerPhone}`.trim()],
    ['Email Address:', data.customerEmail || '—'],
    ['Branch:', locationNames[data.location] || data.location],
    ['Date:', formatBookingDate(data.requestedStartAt)],
    ['Time:', formatBookingTime(data.requestedStartAt)],
  ]
  const labelStyle = audience === 'internal' ? sharedStyles.internalLabelCell : sharedStyles.labelCell
  const valueStyle = audience === 'internal' ? sharedStyles.internalValueCell : sharedStyles.valueCell

  return (
    <table style={sharedStyles.table}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ ...labelStyle, color: audience === 'internal' ? '#3d5a4a' : accentColor }}>{label}</td>
            <td style={{ ...valueStyle, color: audience === 'internal' ? '#2f3f37' : accentColor }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Services({
  data,
  accentColor,
  panelColor,
  audience,
}: {
  data: AppointmentEmailData
  accentColor: string
  panelColor?: string
  audience: EmailAudience
}) {
  const { items, total } = resolveCart(data)
  if (items.length === 0) return null

  return (
    <Section style={audience === 'internal' ? sharedStyles.internalInfoSection : sharedStyles.infoSection}>
      <div style={{ ...sharedStyles.infoBox, backgroundColor: panelColor ?? mixWithWhite(accentColor, 0.91), borderLeftColor: accentColor }}>
        <Heading as="h2" style={{ ...sharedStyles.sectionTitle, color: accentColor }}>Services Selected</Heading>
        <table style={sharedStyles.table}>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.name}-${index}`}>
                <td style={{ ...(audience === 'internal' ? sharedStyles.internalServiceCell : sharedStyles.serviceCell), color: audience === 'internal' ? '#333333' : accentColor }}>
                  <div style={{ fontWeight: 500 }}>{item.name}</div>
                  {item.options.length > 0 ? (
                    <div style={sharedStyles.optionsContainer}>
                      {item.options.map((option, optionIndex) => (
                        <div key={`${option.label}-${optionIndex}`} style={sharedStyles.optionText}>• {option.label}</div>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td style={{ ...(audience === 'internal' ? sharedStyles.internalPriceCell : sharedStyles.priceCell), color: audience === 'internal' ? '#333333' : accentColor }}>{formatPrice(item.totalPrice)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...sharedStyles.totalLabelCell, color: audience === 'internal' ? '#2f3f37' : accentColor, borderTopColor: accentColor }}>Total:</td>
              <td style={{ ...sharedStyles.totalPriceCell, color: accentColor, borderTopColor: accentColor }}>{formatPrice(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function EmailFrame({
  customization,
  audience,
  children,
  header,
}: {
  customization: AppointmentEmailCustomization
  audience: EmailAudience
  children: React.ReactNode
  header: React.ReactNode
}) {
  const colors = resolveEmailColors(customization, audience)
  return (
    <Html>
      <Head>
        {audience === 'customer' ? (
          <link
            href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap"
            rel="stylesheet"
          />
        ) : null}
      </Head>
      <Body
        style={{
          ...sharedStyles.body,
          backgroundColor: colors.background,
          fontFamily: audience === 'customer'
            ? CUSTOMER_APPOINTMENT_EMAIL_FONT_FAMILY
            : INTERNAL_APPOINTMENT_EMAIL_FONT_FAMILY,
        }}
      >
        <table role="presentation" style={sharedStyles.outerTable}>
          <tbody>
            <tr>
              <td align="center" style={sharedStyles.outerCell}>
                <Container style={audience === 'internal' ? { ...sharedStyles.container, boxShadow: '0 6px 18px rgba(0,0,0,0.08)' } : sharedStyles.container}>
                  {header}
                  {children}
                  <Section style={{ ...(audience === 'internal' ? sharedStyles.internalFooter : sharedStyles.footer), backgroundColor: colors.footer }}>
                    <Text style={{ ...(audience === 'internal' ? sharedStyles.internalFooterText : sharedStyles.footerText), color: colors.text }}>
                      {customization.customerFooter}
                    </Text>
                    <Text style={audience === 'internal' ? sharedStyles.internalCopyrightText : sharedStyles.copyrightText}>© {getAppointmentEmailCopyrightYear()} {customization.brandName}</Text>
                  </Section>
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  )
}

export function CustomAppointmentNoti({ data, customization }: CustomAppointmentEmailProps) {
  const colors = resolveEmailColors(customization, 'internal')
  const usesOriginalIntro = customization.internalIntro === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.internalIntro
  const teamName = customization.brandName === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.brandName
    ? 'Privé Team'
    : `${customization.brandName} Team`
  return (
    <EmailFrame
      customization={{ ...customization, customerFooter: customization.internalFooter }}
      audience="internal"
      header={(
        <Section style={{ ...sharedStyles.internalHeader, backgroundColor: colors.header }}>
          {customization.logoUrl ? <img src={customization.logoUrl} alt={`${customization.brandName} logo`} style={sharedStyles.logo} /> : null}
          <Text style={{ ...sharedStyles.internalHeadline, color: colors.headerText }}>{customization.internalHeadline}</Text>
        </Section>
      )}
    >
      <Section style={sharedStyles.internalGreeting}>
        <Text style={sharedStyles.internalGreetingText}>Dear <strong>{teamName}</strong>,</Text>
        <Text style={sharedStyles.internalMessageText}>
          {usesOriginalIntro
            ? <>We're happy to inform you that a new guest has just made a booking at {customization.brandName} on{' '}</>
            : <>{customization.internalIntro}{' '}</>}
          <strong>{formatBookingDate(data.requestedStartAt)}</strong> at <strong>{formatBookingTime(data.requestedStartAt)}</strong>.
          <br />
          {customization.internalPreparation}
        </Text>
      </Section>
      <Section style={sharedStyles.internalInfoSection}>
        <div style={{ ...sharedStyles.infoBox, backgroundColor: colors.panel, borderLeftColor: colors.panelBorder }}>
          <Heading as="h2" style={{ ...sharedStyles.sectionTitle, color: colors.panelBorder }}>Booking Information</Heading>
          <BookingDetails data={data} accentColor={customization.accentColor} audience="internal" />
        </div>
      </Section>
      <Services data={data} accentColor={colors.panelBorder} panelColor={colors.panel} audience="internal" />
      {customization.dashboardUrl ? (
        <Section style={sharedStyles.ctaSection}>
          <Link href={customization.dashboardUrl} style={{ ...sharedStyles.ctaButton, backgroundColor: customization.accentColor }}>
            {customization.internalCtaLabel}
          </Link>
        </Section>
      ) : null}
    </EmailFrame>
  )
}

export function CustomAppointmentConfirmationEmail({ data, customization }: CustomAppointmentEmailProps) {
  const displayName = `${data.salutation || 'Mr'}. ${data.customerName}`
  const colors = resolveEmailColors(customization, 'customer')
  const contactParts = [customization.contactPhone, customization.contactEmail].filter(Boolean)
  const usesOriginalIntro = customization.customerIntro === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.customerIntro
  const usesOriginalPendingNotice = customization.customerPendingNotice === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.customerPendingNotice
  const usesOriginalUpdateBody = customization.updateBody === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.updateBody
  const usesOriginalSignature = customization.signatureText === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.signatureText
  const customerBrandName = customization.brandName === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.brandName
    ? 'The Privé Spa'
    : customization.brandName

  return (
    <EmailFrame
      customization={customization}
      audience="customer"
      header={customization.bannerUrl ? (
        <Section style={{ ...sharedStyles.banner, backgroundImage: `url('${customization.bannerUrl}')` }} />
      ) : (
        <Section style={{ ...sharedStyles.bannerFallback, backgroundColor: customization.accentColor }}>
          <Text style={sharedStyles.bannerFallbackText}>{customization.brandName}</Text>
        </Section>
      )}
    >
      <Section style={sharedStyles.greeting}>
        <Text style={{ ...sharedStyles.greetingText, color: customization.accentColor }}>Dear <strong>{displayName}</strong>,</Text>
        <Text style={{ ...sharedStyles.messageText, color: customization.accentColor }}>
          {usesOriginalIntro ? (
            <>
              Thank you for choosing {customerBrandName}. We have received your <strong>booking request</strong> for{' '}
              <strong>{formatBookingDate(data.requestedStartAt)}</strong> at{' '}
              <strong>{formatBookingTime(data.requestedStartAt)}</strong>.
            </>
          ) : (
            <>
              {customization.customerIntro}{' '}
              <strong>{formatBookingDate(data.requestedStartAt)}</strong> at{' '}
              <strong>{formatBookingTime(data.requestedStartAt)}</strong>.
            </>
          )}
        </Text>
      </Section>
      <Section style={sharedStyles.noticeSection}>
        <div style={sharedStyles.noticeBox}>
          <Text style={sharedStyles.noticeText}>
            {usesOriginalPendingNotice ? (
              <em>
                Please be advised that your appointment has{' '}
                <strong style={sharedStyles.pendingEmphasis}>not yet been confirmed</strong>
                . Our team will review your booking request and contact you shortly. Should a{' '}
                <strong>deposit</strong> be required, we will notify you accordingly. A{' '}
                <strong>confirmation email</strong> will be issued once the booking is finalized.
              </em>
            ) : <em>{customization.customerPendingNotice}</em>}
          </Text>
        </div>
      </Section>
      <Section style={sharedStyles.infoSection}>
        <div style={{ ...sharedStyles.infoBox, backgroundColor: colors.panel, borderLeftColor: colors.panelBorder }}>
          <Heading as="h2" style={{ ...sharedStyles.sectionTitle, color: customization.accentColor }}>Booking Request Details</Heading>
          <BookingDetails data={data} accentColor={customization.accentColor} audience="customer" />
        </div>
      </Section>
      <Services data={data} accentColor={colors.panelBorder} panelColor={colors.panel} audience="customer" />
      <Section style={sharedStyles.noteSection}>
        <Text style={{ ...sharedStyles.noteTitle, color: customization.accentColor }}><strong>{customization.healthSafetyTitle}</strong></Text>
        <Text style={{ ...sharedStyles.noteText, color: customization.accentColor }}>{customization.healthSafetyBody}</Text>
      </Section>
      <Section style={sharedStyles.noteSection}>
        <Text style={{ ...sharedStyles.noteTitle, color: customization.accentColor }}><strong>{customization.updateTitle}</strong></Text>
        <Text style={{ ...sharedStyles.noteText, color: customization.accentColor }}>
          {usesOriginalUpdateBody
            ? 'If you need to adjust your service list, time, or any details, please contact us'
            : customization.updateBody}
          {contactParts.length > 0 ? (usesOriginalUpdateBody ? ' at ' : ' ') : null}
          {customization.contactPhone ? <Link href={`tel:${customization.contactPhone.replace(/\s/g, '')}`} style={{ ...sharedStyles.contactLink, color: customization.accentColor }}>{customization.contactPhone}</Link> : null}
          {customization.contactPhone && customization.contactEmail ? ' or ' : null}
          {customization.contactEmail ? <Link href={`mailto:${customization.contactEmail}`} style={{ ...sharedStyles.contactLink, color: customization.accentColor }}>{customization.contactEmail}</Link> : null}
          {usesOriginalUpdateBody ? ' with your booking reference.' : null}
        </Text>
      </Section>
      <Section style={sharedStyles.noteSection}>
        <Text style={{ ...sharedStyles.closingText, color: customization.accentColor }}>{customization.closingText}</Text>
        <Text style={{ ...sharedStyles.closingText, color: customization.accentColor }}>
          {usesOriginalSignature ? (
            <>
              <strong>Warm regards,</strong>
              <br />
              {customization.brandName === DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION.brandName
                ? 'The Privé Spa Booking Team'
                : `${customization.brandName} Booking Team`}
            </>
          ) : <MultilineText value={customization.signatureText} />}
        </Text>
      </Section>
    </EmailFrame>
  )
}

const sharedStyles: Record<string, React.CSSProperties> = {
  body: { margin: 0, padding: 0 },
  outerTable: { width: '100%', borderCollapse: 'collapse' },
  outerCell: { padding: '40px 20px' },
  container: { maxWidth: '600px', width: '100%', backgroundColor: '#ffffff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 6px 18px rgba(61,90,74,0.12)' },
  internalHeader: { padding: '10px 16px 15px', textAlign: 'center' },
  logo: { width: '300px', height: '100px', borderRadius: '8px' },
  internalHeadline: { margin: 0, fontSize: '15px', fontWeight: 600, letterSpacing: '0.4px' },
  internalGreeting: { padding: '26px 30px 18px' },
  internalGreetingText: { margin: 0, fontSize: '16px', color: '#2f3f37', lineHeight: 1.6 },
  internalMessageText: { margin: '14px 0 0', fontSize: '15px', color: '#3d5a4a', lineHeight: 1.6 },
  banner: { padding: 0, backgroundSize: 'cover', backgroundPosition: 'center', height: '175px' },
  bannerFallback: { height: '175px', textAlign: 'center', padding: '1px 20px' },
  bannerFallbackText: { color: '#ffffff', fontSize: '28px', fontWeight: 700, marginTop: '68px' },
  greeting: { padding: '12px 30px' },
  greetingText: { margin: 0, fontSize: '14px', lineHeight: 1.6, textAlign: 'justify' },
  messageText: { margin: '14px 0 0', fontSize: '14px', lineHeight: 1.6, textAlign: 'justify' },
  copy: { margin: '12px 0 0', fontSize: '14px', lineHeight: 1.6, textAlign: 'justify' },
  noticeSection: { padding: '0 30px 12px' },
  noticeBox: { backgroundColor: '#ffffff', border: '1px solid #d6e1da', borderRadius: '8px', padding: '16px 20px', textAlign: 'center' },
  noticeText: { margin: 0, color: '#5b7a68', fontSize: '13px', lineHeight: 1.5 },
  pendingEmphasis: { color: '#c21c0b', textTransform: 'uppercase', textDecoration: 'underline' },
  infoSection: { padding: '12px 30px' },
  infoBox: { borderLeft: '4px solid', padding: '20px', borderRadius: '8px' },
  sectionTitle: { margin: '0 0 18px', fontSize: '18px', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse' },
  labelCell: { padding: '8px 0', fontWeight: 600, width: '170px', fontSize: '14px' },
  valueCell: { padding: '8px 0', fontSize: '14px', wordBreak: 'break-word' },
  membershipBadge: { display: 'inline-block', padding: '4px 10px', border: '1px solid', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' },
  internalInfoSection: { padding: '0 20px 30px' },
  internalLabelCell: { padding: '8px 0', fontWeight: 600, width: '170px' },
  internalValueCell: { padding: '8px 0 8px 8px', wordBreak: 'break-word' },
  serviceCell: { padding: '10px', borderBottom: '1px solid #d6e1da', fontSize: '14px' },
  internalServiceCell: { padding: '12px 15px', borderBottom: '1px solid #e9ecef' },
  optionsContainer: { marginLeft: '20px', fontSize: '13px', color: '#666666', marginTop: '4px' },
  optionText: { marginTop: '2px' },
  priceCell: { padding: '10px', textAlign: 'right', borderBottom: '1px solid #d6e1da', fontSize: '14px' },
  internalPriceCell: { padding: '12px 15px', textAlign: 'right', borderBottom: '1px solid #e9ecef', whiteSpace: 'nowrap' },
  totalLabelCell: { padding: '14px 10px 0', fontWeight: 700, borderTop: '2px solid', fontSize: '14px' },
  totalPriceCell: { padding: '14px 10px 0', fontWeight: 700, textAlign: 'right', borderTop: '2px solid', fontSize: '14px' },
  ctaSection: { padding: '10px 30px 40px', textAlign: 'center' },
  ctaButton: { display: 'inline-block', color: '#ffffff', padding: '14px 42px', borderRadius: '8px', textDecoration: 'none', fontSize: '15px', fontWeight: 600, boxShadow: '0 4px 12px rgba(45,95,63,0.4)' },
  noteSection: { padding: '12px 30px' },
  noteTitle: { margin: 0, fontSize: '16px', lineHeight: 1.6, textAlign: 'justify' },
  noteText: { margin: '14px 0 0', fontSize: '14px', lineHeight: 1.6, textAlign: 'justify' },
  contactLink: { textDecoration: 'none', fontWeight: 600 },
  closingText: { margin: '0 0 14px', fontSize: '14px', lineHeight: 1.6, textAlign: 'justify' },
  footer: { padding: '12px 20px', textAlign: 'center', borderTop: '1px solid #d6e1da' },
  footerText: { margin: 0, fontSize: '11px' },
  copyrightText: { margin: '12px 0 0', fontSize: '11px', color: '#7a9d8f' },
  internalFooter: { padding: '22px 30px', textAlign: 'center', borderTop: '1px solid #d4e5db' },
  internalFooterText: { margin: 0, fontSize: '13px' },
  internalCopyrightText: { margin: '8px 0 0', fontSize: '12px', color: '#7a9a88' },
}
