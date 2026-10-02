import { render } from '@react-email/components'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { appointmentEmailSettingsSchema } from '../../../lib/email-settings'
import { APPOINTMENT_EMAIL_PREVIEW_DATA, buildAppointmentEmailContent } from '../../../lib/email-content'

const logger = createLogger('appointments').child({ component: 'email-settings-preview' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['appointments.settings.manage'] },
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = appointmentEmailSettingsSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email settings', details: parsed.error.issues }, { status: 400 })
    }

    const content = buildAppointmentEmailContent(APPOINTMENT_EMAIL_PREVIEW_DATA, parsed.data)
    const [internalHtml, customerHtml] = await Promise.all([
      render(content.internal.react),
      render(content.customer.react),
    ])

    return NextResponse.json({
      internal: { subject: content.internal.subject, html: internalHtml },
      customer: { subject: content.customer.subject, html: customerHtml },
    })
  } catch (err) {
    logger.error('POST failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Preview public booking emails',
  methods: {
    POST: {
      summary: 'Render both public booking email previews without saving',
      requestBody: { schema: appointmentEmailSettingsSchema },
      responses: [{ status: 200, description: 'Rendered internal and customer email previews' }],
      errors: [{ status: 400, description: 'Invalid settings' }],
    },
  },
}
