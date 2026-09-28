import { resolveRequestEm } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import { ResourcesResource } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

export async function loadResourcePreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('resources.messageObjects.resource.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveRequestEm()
  const entity = await findOneWithDecryption(
    em,
    ResourcesResource,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!entity) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('customers.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: entity.name,
  }
}
