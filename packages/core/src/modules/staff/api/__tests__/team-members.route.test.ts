/** @jest-environment node */

type CapturedCrudOpts = {
  actions?: {
    delete?: {
      mapInput?: (args: { parsed: unknown; raw: unknown; ctx: Record<string, unknown> }) => Promise<unknown>
    }
  }
} | null

var mockCapturedCrudOpts: CapturedCrudOpts

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: CapturedCrudOpts) => {
    mockCapturedCrudOpts = opts
    return {
      metadata: {},
      GET: jest.fn(),
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import '@open-mercato/core/modules/staff/api/team-members'

const memberId = '123e4567-e89b-12d3-a456-426614174001'

function getDeleteMapInput() {
  const mapInput = mockCapturedCrudOpts?.actions?.delete?.mapInput
  if (!mapInput) throw new Error('Missing team member delete mapInput')
  return mapInput
}

function makeCtx() {
  return {
    auth: {
      tenantId: '123e4567-e89b-12d3-a456-426614174002',
      orgId: '123e4567-e89b-12d3-a456-426614174003',
    },
    selectedOrganizationId: '123e4567-e89b-12d3-a456-426614174003',
  }
}

describe('staff team-members route delete input mapping', () => {
  it('ignores force=true from a DELETE JSON body', async () => {
    await expect(getDeleteMapInput()({
      parsed: { body: { id: memberId, force: true }, query: {} },
      raw: {},
      ctx: makeCtx(),
    })).resolves.toEqual({ id: memberId })
  })

  it('ignores force=true from a DELETE query parameter', async () => {
    await expect(getDeleteMapInput()({
      parsed: { body: { id: memberId }, query: { force: 'true' } },
      raw: {},
      ctx: makeCtx(),
    })).resolves.toEqual({ id: memberId })
  })

  it('ignores force=true from root parsed payloads used by direct callers', async () => {
    await expect(getDeleteMapInput()({
      parsed: { id: memberId, force: true },
      raw: {},
      ctx: makeCtx(),
    })).resolves.toEqual({ id: memberId })
  })
})
