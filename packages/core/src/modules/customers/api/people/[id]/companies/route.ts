import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  loadPersonCompanyLinks,
  summarizePersonCompanies,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveAuthActorId } from '@open-mercato/shared/lib/auth/actor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  personCompanyLinkCreateSchema,
  type PersonCompanyLinkCreateInput,
} from '@open-mercato/core/modules/customers/data/validators'
import { loadPersonContext } from './context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createSchema = z.object({
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
})

const listResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
})

const createResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    displayName: z.string(),
    isPrimary: z.boolean(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked companies for a person',
      responses: [{ status: 200, description: 'Linked company rows', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Link a company to a person',
      requestBody: { schema: createSchema },
      responses: [{ status: 200, description: 'Linked company row', schema: createResponseSchema }],
    },
  },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const { em, person, profile } = await loadPersonContext(req, id)
    const links = await loadPersonCompanyLinks(em, person)
    const items = summarizePersonCompanies(profile, links).map((entry) => ({
      id: entry.linkId ?? entry.companyId,
      companyId: entry.companyId,
      displayName: entry.displayName,
      isPrimary: entry.isPrimary,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = createSchema.parse(await readJsonSafe(req, {}))
    const { container, auth, selectedOrganizationId, em, person } = await loadPersonContext(req, id)
    if (!selectedOrganizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const guardUserId = resolveAuthActorId(auth)
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: guardUserId, tenantId: auth.tenantId, organizationId: selectedOrganizationId },
      input: {
        resourceKind: 'customers.person',
        resourceId: person.id,
        operation: 'custom',
        mutationPayload: payload,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const commandInput = personCompanyLinkCreateSchema.parse({
      personEntityId: person.id,
      companyEntityId: payload.companyId,
      isPrimary: payload.isPrimary,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkCreateInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkCreateInput, { linkId: string; created: boolean; undeleted: boolean }>(
      'customers.personCompanyLinks.create',
      {
        input: commandInput,
        ctx: {
          container,
          auth,
          organizationScope: null,
          selectedOrganizationId,
          organizationIds: [selectedOrganizationId],
          request: req,
        },
      },
    )

    await guardResult.runAfterSuccess()

    const freshEm = (container.resolve('em') as EntityManager).fork()
    const linkRecord = await findOneWithDecryption(
      freshEm,
      CustomerPersonCompanyLink,
      { id: result.linkId, tenantId: auth.tenantId, organizationId: selectedOrganizationId },
      { populate: ['company'] },
      { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
    )
    const company = linkRecord && typeof linkRecord.company !== 'string' ? linkRecord.company : null
    let displayName = company?.displayName ?? ''
    if (!displayName && !company) {
      const fallbackCompany = await findOneWithDecryption(
        freshEm,
        CustomerEntity,
        { id: payload.companyId, tenantId: auth.tenantId, organizationId: selectedOrganizationId, deletedAt: null },
        undefined,
        { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
      )
      displayName = fallbackCompany?.displayName ?? ''
    }

    const response = NextResponse.json({
      ok: true as const,
      result: {
        id: result.linkId,
        companyId: company?.id ?? payload.companyId,
        displayName,
        isPrimary: linkRecord ? Boolean(linkRecord.isPrimary) : Boolean(payload.isPrimary),
      },
    })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'customers.personCompanyLink',
      resourceId: result.linkId,
    })
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
