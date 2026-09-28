import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { attachOperationMetadataHeader } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveAuthActorId } from '@open-mercato/shared/lib/auth/actor'
import { CustomerPersonCompanyLink } from '@open-mercato/core/modules/customers/data/entities'
import {
  personCompanyLinkDeleteSchema,
  personCompanyLinkUpdateSchema,
  type PersonCompanyLinkDeleteInput,
  type PersonCompanyLinkUpdateInput,
} from '@open-mercato/core/modules/customers/data/validators'
import { loadPersonContext } from '../context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const paramsSchema = z.object({
  id: z.string().uuid(),
  linkId: z.string().uuid(),
})

/**
 * Resolve the second path segment to a concrete `customer_person_company_links` row id.
 * The UI on company/person detail pages calls this route with the company entity id as
 * the last segment (symmetric with the other company-centric endpoints); older callers
 * may pass the actual link row id. We try a direct id lookup first, then fall back to
 * resolving via `(person, company)` pair.
 */
async function resolveLinkId(
  em: EntityManager,
  rawLinkId: string,
  personEntityId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<string | null> {
  const decryptionScope = { tenantId, organizationId }
  const directFilter: FilterQuery<CustomerPersonCompanyLink> = organizationId
    ? { id: rawLinkId, tenantId, organizationId, deletedAt: null }
    : { id: rawLinkId, tenantId, deletedAt: null }
  const direct = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    directFilter,
    undefined,
    decryptionScope,
  )
  if (direct) return direct.id

  const companyFilter: FilterQuery<CustomerPersonCompanyLink> = organizationId
    ? {
        person: personEntityId,
        company: rawLinkId,
        tenantId,
        organizationId,
        deletedAt: null,
      }
    : { person: personEntityId, company: rawLinkId, tenantId, deletedAt: null }
  const viaCompany = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    companyFilter,
    undefined,
    decryptionScope,
  )
  return viaCompany?.id ?? null
}

const updateSchema = z.object({
  isPrimary: z.boolean().optional(),
})

const updateResponseSchema = z.object({
  ok: z.literal(true),
  result: z
    .object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    })
    .nullable(),
})

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    PATCH: {
      summary: 'Update a linked company for a person',
      requestBody: { schema: updateSchema },
      responses: [{ status: 200, description: 'Updated company link', schema: updateResponseSchema }],
    },
    DELETE: {
      summary: 'Remove a linked company from a person',
      responses: [{ status: 200, description: 'Deletion result', schema: z.object({ ok: z.literal(true) }) }],
    },
  },
}

export async function PATCH(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const payload = updateSchema.parse(await readJsonSafe(req, {}))
    const { container, auth, selectedOrganizationId, person } = await loadPersonContext(req, id)
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

    if (payload.isPrimary === undefined) {
      return NextResponse.json({ ok: true as const, result: null })
    }

    const resolveEm = (container.resolve('em') as EntityManager).fork()
    const resolvedLinkId = await resolveLinkId(
      resolveEm,
      linkId,
      person.id,
      auth.tenantId,
      selectedOrganizationId,
    )
    if (!resolvedLinkId) {
      throw notFound(translate('customers.errors.person_company_link_not_found', 'Person-company link not found'))
    }

    const commandInput = personCompanyLinkUpdateSchema.parse({
      linkId: resolvedLinkId,
      isPrimary: payload.isPrimary,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkUpdateInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkUpdateInput, { linkId: string }>(
      'customers.personCompanyLinks.update',
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
    const response = NextResponse.json({
      ok: true as const,
      result: linkRecord
        ? {
            id: linkRecord.id,
            companyId: company?.id ?? '',
            displayName: company?.displayName ?? '',
            isPrimary: Boolean(linkRecord.isPrimary),
          }
        : null,
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

export async function DELETE(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const { container, auth, selectedOrganizationId, person } = await loadPersonContext(req, id)
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
        mutationPayload: { id: linkId },
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const resolveEm = (container.resolve('em') as EntityManager).fork()
    const resolvedLinkId = await resolveLinkId(
      resolveEm,
      linkId,
      person.id,
      auth.tenantId,
      selectedOrganizationId,
    )
    if (!resolvedLinkId) {
      throw notFound(translate('customers.errors.person_company_link_not_found', 'Person-company link not found'))
    }

    const commandInput = personCompanyLinkDeleteSchema.parse({
      linkId: resolvedLinkId,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkDeleteInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkDeleteInput, { linkId: string }>(
      'customers.personCompanyLinks.delete',
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

    const response = NextResponse.json({ ok: true as const })
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
