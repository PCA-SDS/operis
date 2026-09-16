import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runCrudMutationGuardAfterSuccess, validateCrudMutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  APPOINTMENT_EMAIL_SETTINGS_KEY,
  APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
  appointmentEmailSettingsSchema,
  DEFAULT_APPOINTMENT_EMAIL_SETTINGS,
} from '../../lib/email-settings'

const logger = createLogger('appointments').child({ component: 'email-settings' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const container = await createRequestContainer()
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const record = await configService.getRecord(
      APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
      APPOINTMENT_EMAIL_SETTINGS_KEY,
      { tenantId: auth.tenantId },
    )
    const value = record?.source === 'tenant' ? record.value : null
    const settings = appointmentEmailSettingsSchema.safeParse(value)
    return NextResponse.json(settings.success ? settings.data : DEFAULT_APPOINTMENT_EMAIL_SETTINGS)
  } catch (err) {
    logger.error('GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = appointmentEmailSettingsSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email settings', details: parsed.error.issues }, { status: 400 })
    }
    const container = await createRequestContainer()
    const actorId =
      (typeof auth.sub === 'string' && auth.sub.trim() && auth.sub) ||
      (typeof auth.userId === 'string' && auth.userId.trim() && auth.userId) ||
      (typeof auth.keyId === 'string' && auth.keyId.trim() && auth.keyId) ||
      'system'
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      userId: actorId,
      resourceKind: 'appointments.email-settings',
      resourceId: APPOINTMENT_EMAIL_SETTINGS_KEY,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    await configService.setValue(
      APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
      APPOINTMENT_EMAIL_SETTINGS_KEY,
      parsed.data,
      { tenantId: auth.tenantId },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: actorId,
        resourceKind: 'appointments.email-settings',
        resourceId: APPOINTMENT_EMAIL_SETTINGS_KEY,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json(parsed.data)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email settings', details: err.issues }, { status: 400 })
    }
    logger.error('PUT failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Public booking email settings',
  methods: {
    GET: { summary: 'Read tenant email settings', responses: [{ status: 200, description: 'Email settings', schema: appointmentEmailSettingsSchema }] },
    PUT: { summary: 'Update tenant email settings', requestBody: { schema: appointmentEmailSettingsSchema }, responses: [{ status: 200, description: 'Updated email settings', schema: appointmentEmailSettingsSchema }], errors: [{ status: 400, description: 'Invalid settings' }] },
  },
}
