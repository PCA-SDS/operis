import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxEmail } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

export async function loadInboxEmailPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const fallbackTitle = t('inbox_ops.preview.email.title', 'Inbox Email')
  if (!ctx.organizationId) {
    return { title: fallbackTitle, subtitle: entityId }
  }

  try {
    const em = await resolveEm()
    const email = await findOneWithDecryption(
      em,
      InboxEmail,
      {
        id: entityId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )

    if (!email) {
      return {
        title: fallbackTitle,
        subtitle: entityId,
        status: t('inbox_ops.preview.email.notFound', 'Not found'),
        statusColor: 'gray',
      }
    }

    const statusColorMap: Record<string, string> = {
      received: 'blue',
      processing: 'amber',
      processed: 'green',
      needs_review: 'amber',
      failed: 'red',
    }

    return {
      title: email.subject || fallbackTitle,
      subtitle: email.forwardedByName || email.forwardedByAddress || undefined,
      status: email.status,
      statusColor: statusColorMap[email.status] || 'gray',
      metadata: {
        ...(email.forwardedByAddress ? { from: email.forwardedByAddress } : {}),
      },
    }
  } catch {
    return { title: fallbackTitle, subtitle: entityId }
  }
}
