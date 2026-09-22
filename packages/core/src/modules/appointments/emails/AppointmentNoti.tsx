import { Body, Container, Head, Heading, Html, Section, Text } from '@react-email/components'
import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildCartItems,
  calculateCartTotal,
  formatBookingDate,
  formatBookingTime,
  type AppointmentEmailData as BookingEmailData,
  type CartItem,
} from './appointment-email'
import { EMAIL_FONT_FAMILY } from '@open-mercato/shared/lib/email/typography'

const logger = createLogger('appointments').child({ component: 'email-template' })

export default function BookingNoti(data: BookingEmailData) {
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
      logger.error('Error building cart items for email', { err })
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

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <table role="presentation" style={styles.outerTable}>
          <tbody>
            <tr>
              <td align="center" style={styles.outerCell}>
                <Container style={styles.container}>
                  {/* Header with Logo */}
                  <Section style={styles.header}>
                    <img
                      src="https://drive.google.com/thumbnail?id=1X40oxtRs2quWRC0hioI920sDs7smo9bc&sz=w1000"
                      alt="Privé Spa Logo"
                      style={styles.logo}
                    />
                    <Text style={styles.headerText}>A Guest Is Waiting for Us</Text>
                  </Section>

                  {/* Greeting */}
                  <Section style={styles.greeting}>
                    <Text style={styles.greetingText}>
                      Dear <strong>Privé Team</strong>,
                    </Text>
                    <Text style={styles.messageText}>
                      We're happy to inform you that a new guest has just made a booking at Privé Spa on{' '}
                      <strong>{formatBookingDate(data.requestedStartAt)}</strong> at{' '}
                      <strong>{formatBookingTime(data.requestedStartAt)}</strong>
                      .
                      <br />
                      Please review the details below and prepare a calm, refreshing experience for our guest.
                    </Text>
                  </Section>

                  {/* Booking Information */}
                  <Section style={styles.infoSection}>
                    <div style={styles.infoBox}>
                      <Heading as="h2" style={styles.sectionTitle}>
                        Booking Information
                      </Heading>

                      <table style={styles.table}>
                        <tbody>
                          <tr>
                            <td style={styles.labelCell}>Guest Name:</td>
                            <td style={styles.valueCell}>
                              {data.salutation}. {data.customerName}
                            </td>
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

                  {/* CTA Button */}
                  <Section style={styles.ctaSection}>
                    <a href="https://prive-dashboard.web.app/bookings" style={styles.ctaButton}>
                      View in Dashboard →
                    </a>
                  </Section>

                  {/* Footer */}
                  <Section style={styles.footer}>
                    <Text style={styles.footerText}>
                      This is an automated notification from Privé Spa Booking System
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
    backgroundColor: '#e8f3ed',
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
    boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
  },
  header: {
    padding: '10px 16px 15px 16px',
    backgroundColor: '#1e4d2b',
    textAlign: 'center' as const,
  },
  logo: {
    width: '300px',
    height: '100px',
    borderRadius: '8px',
  },
  headerText: {
    margin: 0,
    color: '#cccccc',
    fontSize: '15px',
    fontWeight: 600,
    letterSpacing: '0.4px',
  },
  greeting: {
    padding: '26px 30px 18px 30px',
  },
  greetingText: {
    margin: 0,
    fontSize: '16px',
    color: '#2f3f37',
    lineHeight: 1.6,
  },
  messageText: {
    margin: '14px 0 0 0',
    fontSize: '15px',
    color: '#3d5a4a',
    lineHeight: 1.6,
  },
  infoSection: {
    padding: '0 20px 30px 20px',
  },
  infoBox: {
    backgroundColor: '#f0f7f3',
    borderLeft: '4px solid #2d5f3f',
    padding: '20px',
    borderRadius: '8px',
  },
  sectionTitle: {
    margin: '0 0 18px 0',
    fontSize: '18px',
    color: '#2d5f3f',
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
  },
  valueCell: {
    padding: '8px 0 8px 8px',
    color: '#2f3f37',
  },
  serviceCell: {
    padding: '12px 15px',
    borderBottom: '1px solid #e9ecef',
    color: '#333',
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
    padding: '12px 15px',
    borderBottom: '1px solid #e9ecef',
    color: '#333',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  },
  totalLabelCell: {
    padding: '14px 10px 0 10px',
    fontWeight: 700,
    color: '#2f3f37',
    borderTop: '2px solid #2d5f3f',
  },
  totalPriceCell: {
    padding: '14px 10px 0 10px',
    fontWeight: 700,
    color: '#2d5f3f',
    textAlign: 'right' as const,
    borderTop: '2px solid #2d5f3f',
  },
  ctaSection: {
    padding: '10px 30px 40px 30px',
    textAlign: 'center' as const,
  },
  ctaButton: {
    display: 'inline-block',
    padding: '14px 42px',
    backgroundColor: '#1e4d2b',
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '15px',
    boxShadow: '0 4px 12px rgba(45,95,63,0.4)',
  },
  footer: {
    padding: '22px 30px',
    backgroundColor: '#f0f7f3',
    textAlign: 'center' as const,
    borderTop: '1px solid #d4e5db',
  },
  footerText: {
    margin: 0,
    fontSize: '13px',
    color: '#5a7a68',
  },
  copyrightText: {
    margin: '8px 0 0 0',
    fontSize: '12px',
    color: '#7a9a88',
  },
}
