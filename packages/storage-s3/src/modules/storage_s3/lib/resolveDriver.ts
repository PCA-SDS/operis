import { S3StorageDriver } from './s3-driver'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

export async function resolveDriver(tenantId: string, orgId: string): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver({ ...creds, organizationId: orgId, tenantId })
}
