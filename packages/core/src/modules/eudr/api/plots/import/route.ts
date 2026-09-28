import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { collectFeatures } from '../../../lib/geometry'
import { plotCreateSchema } from '../../../data/validators'
import { resolveGrantedFeatures } from '@open-mercato/shared/lib/auth/grantedFeatures'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { finiteNumberOrNull } from '@open-mercato/shared/lib/number'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { resolveRequestContext } from '../../requestContext'

const logger = createLogger('eudr').child({ component: 'api/plots/import' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['eudr.plots.manage'] },
}

const importSchema = z.object({
  supplierEntityId: z.string().uuid(),
  defaultCountry: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
  featureCollection: z.unknown(),
})

type PlotImportInput = z.infer<typeof importSchema>
type PlotImportFailure = { index: number; name: string; errorKey: string }
type CommandCreateResult = { entityId?: string; id?: string }

function featureProperties(feature: unknown): Record<string, unknown> {
  if (!isRecord(feature)) return {}
  const properties = feature.properties
  return isRecord(properties) ? properties : {}
}

function featureGeometryType(feature: unknown): string | null {
  if (!isRecord(feature)) return null
  if (feature.type === 'Feature' && isRecord(feature.geometry) && typeof feature.geometry.type === 'string') {
    return feature.geometry.type
  }
  return typeof feature.type === 'string' ? feature.type : null
}

function resolveFeatureName(properties: Record<string, unknown>, index: number): string {
  return normalizeOptionalString(properties.name)
    ?? normalizeOptionalString(properties.ProductionPlace)
    ?? `Plot ${index + 1}`
}

function errorKeyFromError(error: unknown): string {
  if (isCrudHttpError(error)) {
    const bodyError = error.body?.error
    return typeof bodyError === 'string' && bodyError.length > 0 ? bodyError : 'eudr.errors.plot_import_failed'
  }
  if (error instanceof z.ZodError) {
    const firstMessage = error.issues[0]?.message
    return typeof firstMessage === 'string' && firstMessage.length > 0 ? firstMessage : 'eudr.errors.plot_import_failed'
  }
  return 'eudr.errors.plot_import_failed'
}

async function loadSupplierDisplayName(
  queryEngine: QueryEngine,
  scope: { tenantId: string; organizationId: string },
  supplierEntityId: string,
): Promise<string | null> {
  // Soft cross-module read (FK-id convention) via the query engine — no direct
  // customers entity import; degrades to null when the peer is absent so the
  // import still succeeds without a snapshot.
  try {
    const customersEntityId = (E as Record<string, Record<string, string>>).customers?.customer_entity
    if (!customersEntityId) return null
    const result = await queryEngine.query<Record<string, unknown>>(customersEntityId, {
      fields: ['id', 'display_name'],
      filters: { id: { $in: [supplierEntityId] } },
      page: { page: 1, pageSize: 1 },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const rawName = result.items[0]?.display_name ?? result.items[0]?.displayName
    return typeof rawName === 'string' && rawName.length ? rawName : null
  } catch {
    return null
  }
}

async function createPlotFromFeature(args: {
  commandBus: CommandBus
  ctx: CommandRuntimeContext
  scope: { tenantId: string; organizationId: string }
  input: PlotImportInput
  feature: unknown
  index: number
  supplierDisplayName: string | null
}): Promise<{ id: string | null }> {
  const properties = featureProperties(args.feature)
  const name = resolveFeatureName(properties, args.index)
  const originCountry = normalizeOptionalString(properties.ProducerCountry) ?? args.input.defaultCountry ?? null
  if (!originCountry) throw new CrudHttpError(400, { error: 'eudr.errors.importCountryMissing' })

  const area = finiteNumberOrNull(properties.Area)
  const base = {
    supplierEntityId: args.input.supplierEntityId,
    name,
    originCountry,
    geometry: args.feature,
    producerName: normalizeOptionalString(properties.ProducerName),
    areaHa: featureGeometryType(args.feature) === 'Point' && area !== null ? area : undefined,
    supplierSnapshot: args.supplierDisplayName ? { displayName: args.supplierDisplayName } : undefined,
  }
  const parsed = plotCreateSchema.parse(base)
  const { result } = await args.commandBus.execute<typeof parsed & { tenantId: string; organizationId: string }, CommandCreateResult>(
    'eudr.plots.create',
    {
      input: {
        ...parsed,
        tenantId: args.scope.tenantId,
        organizationId: args.scope.organizationId,
      },
      ctx: args.ctx,
      metadata: {
        tenantId: args.scope.tenantId,
        organizationId: args.scope.organizationId,
        resourceKind: 'eudr.plot',
        context: { cacheAliases: ['eudr.plot'] },
      },
    },
  )
  return { id: result?.entityId ?? result?.id ?? null }
}

export async function POST(req: Request) {
  try {
    const requestContext = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await readJsonSafe(req, {})
    const input = importSchema.parse(payload)
    const guardResult = await runRouteMutationGuards({
      container: requestContext.ctx.container,
      req,
      auth: {
        userId: requestContext.ctx.auth?.sub ?? '',
        tenantId: requestContext.tenantId,
        organizationId: requestContext.organizationId,
        userFeatures: await resolveGrantedFeatures(requestContext.ctx.container, requestContext.ctx.auth, requestContext.organizationId),
      },
      input: {
        resourceKind: 'eudr.plot',
        resourceId: null,
        operation: 'create',
        mutationPayload: {
          supplierEntityId: input.supplierEntityId,
          defaultCountry: input.defaultCountry ?? null,
        },
      },
    })
    if (!guardResult.ok) return guardResult.response
    const guardPatch = guardResult.modifiedPayload ?? null
    const effectiveSupplierEntityId = typeof guardPatch?.supplierEntityId === 'string' && guardPatch.supplierEntityId.length
      ? guardPatch.supplierEntityId
      : input.supplierEntityId
    const effectiveDefaultCountry = typeof guardPatch?.defaultCountry === 'string' && guardPatch.defaultCountry.length
      ? guardPatch.defaultCountry
      : input.defaultCountry

    const featureResult = collectFeatures(input.featureCollection)
    if (!featureResult.ok) {
      return Response.json({ errorKey: featureResult.errorKey }, { status: 400 })
    }

    const commandBus = requestContext.ctx.container.resolve('commandBus') as CommandBus
    const failed: PlotImportFailure[] = []
    const createdIds: string[] = []
    const effectiveInput: PlotImportInput = {
      ...input,
      supplierEntityId: effectiveSupplierEntityId,
      defaultCountry: effectiveDefaultCountry,
    }

    const importScope = { tenantId: requestContext.tenantId, organizationId: requestContext.organizationId }
    const supplierDisplayName = await loadSupplierDisplayName(
      requestContext.ctx.container.resolve('queryEngine') as QueryEngine,
      importScope,
      effectiveSupplierEntityId,
    )

    for (const [index, feature] of featureResult.features.entries()) {
      const name = resolveFeatureName(featureProperties(feature), index)
      try {
        const created = await createPlotFromFeature({
          commandBus,
          ctx: requestContext.ctx,
          scope: importScope,
          input: effectiveInput,
          feature,
          index,
          supplierDisplayName,
        })
        if (created.id) createdIds.push(created.id)
      } catch (error) {
        failed.push({ index, name, errorKey: errorKeyFromError(error) })
      }
    }

    for (const id of createdIds) {
      await guardResult.runAfterSuccess({ resourceId: id })
    }

    return Response.json({ created: createdIds.length, failed })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    const { translate } = await resolveTranslations()
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: translate('eudr.errors.plot_import_failed', 'Failed to import plots') },
        { status: 400 },
      )
    }
    logger.error('Plot import failed', { err: error })
    return Response.json(
      { error: translate('eudr.errors.plot_import_failed', 'Failed to import plots') },
      { status: 500 },
    )
  }
}

const importResponseSchema = z.object({
  created: z.number(),
  failed: z.array(z.object({
    index: z.number(),
    name: z.string(),
    errorKey: z.string(),
  })),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Import EUDR plots from GeoJSON',
  methods: {
    POST: {
      summary: 'Import plots',
      requestBody: {
        contentType: 'application/json',
        schema: importSchema,
      },
      responses: [
        { status: 200, description: 'Import result', schema: importResponseSchema },
        { status: 400, description: 'Invalid import payload', schema: z.object({ error: z.string().optional(), errorKey: z.string().optional() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Plot import failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
