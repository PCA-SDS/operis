import { Body, Container, Head, Heading, Html, Section, Text, Link } from '@react-email/components'
import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildCartItems,
  calculateCartTotal,
  formatBookingDate,
  formatBookingTime,
  type AppointmentEmailData as BookingCustomerEmailData,
  type CartItem,
} from './appointment-email'
import { EMAIL_FONT_FAMILY } from '@open-mercato/shared/lib/email/typography'

const logger = createLogger('appointments').child({ component: 'email-template' })

export default function AppointmentConfirmationEmail(data: BookingCustomerEmailData) {

  // Location names mapping
  const locationNames: Record<string, string> = {
    benThanh: 'Ben Thanh',
    thaoDien: 'Thao Dien',
    phuMyHung: 'Phu My Hung',
    hoanKiem: 'Hoan Kiem',
  }

  // Membership badge styles
  const membershipBadgeStyles: Record<string, { bg: string; text: string; border: string }> = {
    gold: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
    silver: { bg: '#f1f5f9', text: '#1e293b', border: '#e2e8f0' },
    expat: { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
  }

  // Build cart items from service selections
  let cartItems: CartItem[] = []
  let totalPrice: number | { min: number; max: number } = 0

  if (data.serviceSelections && data.serviceSelections.length > 0) {
    try {
      cartItems = buildCartItems(data.serviceSelections, undefined, true)
      totalPrice = calculateCartTotal(cartItems)
    } catch (err) {
      logger.error('Error building customer email cart items', { err })
    }
  }

  // Format total price
  const totalPriceFormatted =
    typeof totalPrice === 'number'
      ? `${totalPrice.toLocaleString('vi-VN')} VND`
      : totalPrice.max > 0
        ? `${totalPrice.min.toLocaleString('vi-VN')} - ${totalPrice.max.toLocaleString('vi-VN')} VND`
        : '0 VND'

  // Get membership style
  const membershipStyle = data.membership
    ? membershipBadgeStyles[data.membership.toLowerCase()] || {
        bg: '#2d5f3f',
        text: '#ffffff',
        border: '#2d5f3f',
      }
    : null

  const displayName = `${data.salutation || 'Mr'}. ${data.customerName}`

  return (
    <Html>
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Body style={styles.body}>
        <table role="presentation" style={styles.outerTable}>
          <tbody>
            <tr>
              <td align="center" style={styles.outerCell}>
                <Container style={styles.container}>
                  {/* Header Banner */}
                  <Section style={styles.header} />
                  {/* Greeting */}
                  <Section style={styles.greeting}>
                    <Text style={styles.greetingText}>
                      Dear <strong>{displayName}</strong>,
                    </Text>
                    <Text style={styles.messageText}>
                      Thank you for choosing The Privé Spa. We have received your <strong>booking request</strong> for{' '}
                      <strong>{formatBookingDate(data.requestedStartAt)}</strong> at{' '}
                      <strong>{formatBookingTime(data.requestedStartAt)}</strong>
                      .
                    </Text>
                  </Section>
                  {/* Next Steps */}i
                  <Section style={styles.nextStepsSection}>
                    <div style={styles.nextStepsBox}>
                      <Text style={styles.nextStepsText}>
                        <em>
                          Please be advised that your appointment has{' '}
                          <strong style={{ color: '#c21c0b', textTransform: 'uppercase', textDecoration: 'underline' }}>
                            not yet been confirmed
                          </strong>
                          . Our team will review your booking request and contact you shortly. Should a{' '}
                          <strong>deposit</strong> be required, we will notify you accordingly. A{' '}
                          <strong>confirmation email</strong> will be issued once the booking is finalized.
                        </em>
                      </Text>
                    </div>
                  </Section>
                  {/* Booking Information */}
                  <Section style={styles.infoSection}>
                    <div style={styles.infoBox}>
                      <Heading as="h2" style={styles.sectionTitle}>
                        Booking Request Details
                      </Heading>

                      <table style={styles.table}>
                        <tbody>
                          <tr>
                            <td style={styles.labelCell}>Name:</td>
                            <td style={styles.valueCell}>{displayName}</td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Membership:</td>
                            <td style={styles.valueCell}>
                              {data.membership && data.membership !== 'none' && membershipStyle ? (
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '4px 10px',
                                    backgroundColor: membershipStyle.bg,
                                    color: membershipStyle.text,
                                    border: `1px solid ${membershipStyle.border}`,
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {data.membership}
                                </span>
                              ) : (
                                'Not Yet'
                              )}
                            </td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Zalo / WhatsApp:</td>
                            <td style={styles.valueCell}>
                              {data.countryCode} {data.customerPhone}
                            </td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Email Address:</td>
                            <td style={{ ...styles.valueCell, wordBreak: 'break-word' }}>{data.customerEmail || '—'}</td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Branch:</td>
                            <td style={styles.valueCell}>{locationNames[data.location] || data.location}</td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Date:</td>
                            <td style={styles.valueCell}>{formatBookingDate(data.requestedStartAt)}</td>
                          </tr>

                          <tr>
                            <td style={styles.labelCell}>Time:</td>
                            <td style={styles.valueCell}>{formatBookingTime(data.requestedStartAt)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </Section>
                  {/* Services Selected */}
                  {cartItems.length > 0 && (
                    <Section style={styles.infoSection}>
                      <div style={styles.infoBox}>
                        <Heading as="h2" style={styles.sectionTitle}>
                          Services Selected
                        </Heading>

                        <table style={styles.table}>
                          <tbody>
                            {cartItems.map((item, index) => {
                              const itemTotal =
                                typeof item.totalPrice === 'number'
                                  ? `${item.totalPrice.toLocaleString('vi-VN')} VND`
                                  : `${item.totalPrice.min.toLocaleString('vi-VN')} - ${item.totalPrice.max.toLocaleString('vi-VN')} VND`

                              return (
                                <tr key={index}>
                                  <td style={styles.serviceCell}>
                                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                                    {item.options && item.options.length > 0 && (
                                      <div style={styles.optionsContainer}>
                                        {item.options.map((opt, optIndex) => (
                                          <div key={optIndex} style={styles.optionText}>
                                            • {opt.label}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td style={styles.priceCell}>{itemTotal}</td>
                                </tr>
                              )
                            })}

                            <tr>
                              <td style={styles.totalLabelCell}>Total:</td>
                              <td style={styles.totalPriceCell}>{totalPriceFormatted}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </Section>
                  )}
                  {/* Important Notes (Health & Safety) */}
                  <Section style={styles.noteSection}>
                    <Text style={styles.noteTitle}>
                      <strong>Important Notes (Health &amp; Safety)</strong>
                    </Text>
                    <Text style={styles.noteText}>
                      To help us serve you safely and comfortably, please contact us as soon as possible if you have any
                      relevant health conditions, allergies, pregnancy, skin sensitivity, recent treatments/medications,
                      or any concerns that may affect the Services. If such information is not disclosed in advance, we
                      may be unable to accommodate adjustments on-site, and The Privé Spa may not be responsible for
                      outcomes arising from non-disclosure.
                    </Text>
                  </Section>
                  {/* Need to Update Your Booking? */}
                  <Section style={styles.noteSection}>
                    <Text style={styles.noteTitle}>
                      <strong>Need to Update Your Booking?</strong>
                    </Text>
                    <Text style={styles.noteText}>
                      If you need to adjust your service list, time, or any details, please contact us at{' '}
                      <Link href="tel:+84909095491" style={styles.contactLink}>
                        +84 909 095 491
                      </Link>{' '}
                      or{' '}
                      <Link href="mailto:info@theprivespa.vn" style={styles.contactLink}>
                        info@theprivespa.vn
                      </Link>{' '}
                      with your booking reference.
                    </Text>
                  </Section>
                  {/* Closing */}
                  <Section style={styles.noteSection}>
                    <Text style={styles.closingText}>We look forward to welcoming you.</Text>
                    <Text style={styles.closingText}>
                      <strong>Warm regards,</strong>
                      <br />
                      The Privé Spa Booking Team
                    </Text>
                  </Section>
                  {/* Footer */}
                  <Section style={styles.footer}>
                    <Text style={styles.footerText}>
                      This is an automated notification from the Privé Spa Booking System. Please do not reply to this
                      email.
                    </Text>
                    <Text style={styles.copyrightText}>© 2024 Privé Spa</Text>
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

// Styles
const styles = {
  body: {
    margin: 0,
    padding: 0,
    fontFamily: EMAIL_FONT_FAMILY,
    backgroundColor: '#eef4f1',
  },
  outerTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  outerCell: {
    padding: '40px 20px',
  },
  container: {
    maxWidth: '600px',
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 6px 18px rgba(61,90,74,0.12)',
  },
  header: {
    padding: 0,
    backgroundImage: "url('https://res.cloudinary.com/dff8ir6kc/image/upload/v1773810194/1_ilxnnx.png')",
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    height: '175px',
    textAlign: 'center' as const,
    position: 'relative' as const,
    color: '#ffffff',
  },
  greeting: {
    padding: '12px 30px',
  },
  greetingText: {
    margin: 0,
    fontSize: '14px',
    color: '#3d5a4a',
    lineHeight: 1.6,
    textAlign: 'justify' as const,
  },
  messageText: {
    margin: '14px 0 0 0',
    fontSize: '14px',
    color: '#3d5a4a',
    lineHeight: 1.6,
    textAlign: 'justify' as const,
  },
  nextStepsSection: {
    padding: '0 30px 12px 30px',
  },
  nextStepsBox: {
    backgroundColor: '#ffffff',
    border: '1px solid #d6e1da',
    borderRadius: '8px',
    padding: '16px 20px',
    textAlign: 'center' as const,
  },
  nextStepsTitle: {
    margin: '0 0 8px 0',
    color: '#3d5a4a',
    fontSize: '15px',
  },
  nextStepsText: {
    margin: 0,
    color: '#5b7a68',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  infoSection: {
    padding: '12px 30px',
  },
  infoBox: {
    backgroundColor: '#eef4f1',
    borderLeft: '4px solid #3d5a4a',
    padding: '20px',
    borderRadius: '8px',
  },
  sectionTitle: {
    margin: '0 0 18px 0',
    fontSize: '18px',
    color: '#3d5a4a',
    fontWeight: 600,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  labelCell: {
    padding: '8px 0',
    fontWeight: 600,
    color: '#3d5a4a',
    width: '170px',
    fontSize: '14px',
  },
  valueCell: {
    padding: '8px 0',
    color: '#3d5a4a',
    fontSize: '14px',
  },
  serviceCell: {
    padding: '10px',
    color: '#3d5a4a',
    borderBottom: '1px solid #d6e1da',
    fontSize: '14px',
  },
  optionsContainer: {
    marginLeft: '20px',
    fontSize: '13px',
    color: '#666',
    marginTop: '4px',
  },
  optionText: {
    marginTop: '2px',
  },
  priceCell: {
    padding: '10px',
    color: '#3d5a4a',
    textAlign: 'right' as const,
    borderBottom: '1px solid #d6e1da',
    fontSize: '14px',
  },
  totalLabelCell: {
    padding: '14px 10px 0 10px',
    fontWeight: 700,
    color: '#3d5a4a',
    borderTop: '2px solid #3d5a4a',
    fontSize: '14px',
  },
  totalPriceCell: {
    padding: '14px 10px 0 10px',
    fontWeight: 700,
    color: '#3d5a4a',
    textAlign: 'right' as const,
    borderTop: '2px solid #3d5a4a',
    fontSize: '14px',
  },
  noteSection: {
    padding: '12px 30px',
  },
  noteTitle: {
    margin: 0,
    fontSize: '16px',
    color: '#3d5a4a',
    lineHeight: 1.6,
    textAlign: 'justify' as const,
  },
  noteText: {
    margin: '14px 0 0 0',
    fontSize: '14px',
    color: '#3d5a4a',
    lineHeight: 1.6,
    textAlign: 'justify' as const,
  },
  contactLink: {
    color: '#3d5a4a',
    textDecoration: 'none',
    fontWeight: 600,
  },
  closingText: {
    margin: '0 0 14px 0',
    fontSize: '14px',
    color: '#3d5a4a',
    lineHeight: 1.6,
    textAlign: 'justify' as const,
  },
  footer: {
    padding: '12px 20px',
    backgroundColor: '#eef4f1',
    textAlign: 'center' as const,
    borderTop: '1px solid #d6e1da',
  },
  footerText: {
    margin: 0,
    fontSize: '11px',
    color: '#3d5a4a',
  },
  copyrightText: {
    margin: '12px 0 0 0',
    fontSize: '11px',
    color: '#7a9d8f',
  },
}
