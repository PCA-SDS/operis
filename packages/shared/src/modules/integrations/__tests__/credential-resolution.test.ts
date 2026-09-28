import { inspect } from 'node:util'
import {
  IntegrationCredentialError,
  buildIntegrationCredentialErrorBody,
  createIntegrationSecret,
  isIntegrationCredentialError,
  requireIntegrationCredentialResolver,
  resolveIntegrationCredentialResolver,
  INTEGRATION_CREDENTIAL_RESOLVER_KEY,
} from '../credential-resolution'

describe('createIntegrationSecret', () => {
  it('reveals the value only on request', () => {
    const secret = createIntegrationSecret('sk-live-value')

    expect(secret.reveal()).toBe('sk-live-value')
    expect(String(secret)).toBe('[redacted]')
    expect(`${secret}`).toBe('[redacted]')
    expect(JSON.stringify({ secret })).toBe('{"secret":"[redacted]"}')
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain('sk-live-value')
    expect(Object.isFrozen(secret)).toBe(true)
  })
})

describe('isIntegrationCredentialError', () => {
  it('recognises errors structurally so copies from another bundle chunk still match', () => {
    const foreignCopy = Object.assign(new Error('x'), { name: 'IntegrationCredentialError', code: 'integration_not_configured' })

    expect(isIntegrationCredentialError(new IntegrationCredentialError('integration_disabled'))).toBe(true)
    expect(isIntegrationCredentialError(foreignCopy)).toBe(true)
  })

  it('rejects unrelated errors and unknown codes', () => {
    expect(isIntegrationCredentialError(new Error('boom'))).toBe(false)
    expect(isIntegrationCredentialError({ name: 'IntegrationCredentialError', code: 'made_up' })).toBe(false)
    expect(isIntegrationCredentialError(null)).toBe(false)
  })
})

describe('buildIntegrationCredentialErrorBody', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? ''

  it('gives service-specific, actionable messages', () => {
    expect(buildIntegrationCredentialErrorBody(new IntegrationCredentialError('integration_not_configured', { service: 'email' }), translate))
      .toEqual({ error: expect.stringContaining('Resend'), code: 'integration_not_configured' })
    expect(buildIntegrationCredentialErrorBody(new IntegrationCredentialError('integration_not_configured', { service: 'ai' }), translate).error)
      .toContain('AI provider')
  })

  it('hides internal detail behind a generic message for system failures', () => {
    const error = new IntegrationCredentialError('credential_unreadable', {
      integrationId: 'resend',
      cause: new Error('decrypt failed for tenant 123'),
    })

    const body = buildIntegrationCredentialErrorBody(error, translate)

    expect(body.code).toBe('credential_unreadable')
    expect(body.error).not.toContain('decrypt')
    expect(error.status).toBe(503)
  })
})

describe('resolveIntegrationCredentialResolver', () => {
  it('returns null when the integrations module did not register the resolver', () => {
    const container = { resolve: jest.fn(), hasRegistration: () => false }

    expect(resolveIntegrationCredentialResolver(container)).toBeNull()
    expect(container.resolve).not.toHaveBeenCalled()
    expect(() => requireIntegrationCredentialResolver(container)).toThrow(IntegrationCredentialError)
  })

  it('resolves the registered resolver by its DI key', () => {
    const resolver = { resolve: jest.fn() }
    const container = {
      resolve: jest.fn((name: string) => (name === INTEGRATION_CREDENTIAL_RESOLVER_KEY ? resolver : null)),
      hasRegistration: (name: string) => name === INTEGRATION_CREDENTIAL_RESOLVER_KEY,
    }

    expect(resolveIntegrationCredentialResolver(container as never)).toBe(resolver)
  })
})
