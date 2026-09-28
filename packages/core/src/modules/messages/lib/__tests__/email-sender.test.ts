import { createTestCredentialResolver } from '@open-mercato/shared/lib/testing/integrationCredentials'
import {
  createMessageAccessToken,
  sendMessageEmailToExternal,
  sendMessageEmailToRecipient,
} from '../email-sender'

function containerWith(resolver: ReturnType<typeof createTestCredentialResolver>) {
  return {
    resolve: <T,>(name: string) => (name === 'integrationCredentialResolver' ? resolver : undefined) as T,
    hasRegistration: (name: string) => name === 'integrationCredentialResolver',
  }
}

const sendEmailMock = jest.fn(async () => {})
const loadDictionaryMock = jest.fn(async () => ({}))
const createFallbackTranslatorMock = jest.fn(() => (
  (_key: string, fallback?: string) => fallback ?? 'fallback'
))
const messageEmailMock = jest.fn((props: Record<string, unknown>) => ({ props }))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: (...args: unknown[]) => loadDictionaryMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createFallbackTranslator: (...args: unknown[]) => createFallbackTranslatorMock(...args),
}))

jest.mock('../../emails/MessageEmail', () => ({
  __esModule: true,
  default: (...args: unknown[]) => messageEmailMock(...args),
}))

function createEm() {
  const flush = jest.fn(async () => {})
  return {
    create: jest.fn((_entity, payload) => payload),
    persist: jest.fn(() => ({ flush })),
    flush,
  }
}

const baseMessage = {
  id: 'message-1',
  subject: 'Subject',
  body: 'Body',
  sentAt: new Date('2026-02-15T10:00:00.000Z'),
} as never

const scopedMessage = {
  id: 'message-1',
  subject: 'Subject',
  body: 'Body',
  sentAt: new Date('2026-02-15T10:00:00.000Z'),
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
} as never

describe('messages email sender', () => {
  const appUrl = process.env.APP_URL

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://mercato.test/'
  })

  afterAll(() => {
    process.env.APP_URL = appUrl
  })

  it('creates and persists access token as an HMAC hash while returning the raw token', async () => {
    const em = createEm()

    const token = await createMessageAccessToken(
      em as never,
      'message-1',
      'user-1',
    )

    expect(token).toHaveLength(64)
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, payload] = em.create.mock.calls[0] as [unknown, { token: string }]
    const { hashAuthToken } = require('../../../auth/lib/tokenHash')
    expect(payload.token).toBe(hashAuthToken(token))
    expect(payload.token).not.toBe(token)
  })

  it('sends recipient email with generated view url', async () => {
    const em = createEm()

    await sendMessageEmailToRecipient({
      em: em as never,
      message: baseMessage,
      recipientUserId: 'user-2',
      recipientEmail: 'user2@example.com',
      sender: { name: 'Alice', email: 'alice@example.com' },
      objects: [
        {
          entityModule: 'sales',
          entityType: 'order',
          entityId: 'order-1',
        },
      ] as never,
      attachments: [
        {
          fileName: 'invoice.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          partitionCode: 'private',
          storagePath: 'org_shared/tenant_shared/invoice.pdf',
          storageDriver: 'local',
        },
      ],
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user2@example.com',
        subject: 'Subject',
      }),
    )
    expect(messageEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderName: 'Alice',
        viewUrl: expect.stringMatching(/^https:\/\/mercato\.test\/messages\/view\//),
        attachmentNames: ['invoice.pdf'],
        objectLabels: ['sales.order (order-1)'],
      }),
    )
  })

  it('sends external email without view url', async () => {
    const resolver = createTestCredentialResolver({ resend: { secret: 're_org_messages_key' } })
    await sendMessageEmailToExternal({
      container: containerWith(resolver),
      message: scopedMessage,
      email: 'external@example.com',
      sender: { name: null, email: 'sender@example.com' },
      objects: [],
      attachments: [],
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'external@example.com',
        subject: 'Subject',
        apiKey: 're_org_messages_key',
      }),
    )
    expect(resolver.requests[0]).toMatchObject({
      integrationId: 'resend',
      scope: { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' },
      operation: 'messages.message.email_external',
    })
    expect(messageEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderName: 'sender@example.com',
        viewUrl: null,
      }),
    )
  })

  it('does not send external email when the organization has no email credential', async () => {
    await expect(sendMessageEmailToExternal({
      container: containerWith(createTestCredentialResolver({})),
      message: scopedMessage,
      email: 'external@example.com',
      sender: { name: null, email: 'sender@example.com' },
      objects: [],
      attachments: [],
    })).rejects.toMatchObject({ code: 'integration_not_configured' })

    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
