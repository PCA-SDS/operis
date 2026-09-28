import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { createAttachmentQuotaService, type AttachmentQuotaService } from './lib/quota-service'
import { scheduleAttachmentQuotaRecovery } from './lib/quota-recovery-queue'
import { AttachmentTargetAccessService } from './lib/target-access-service'
import { ScopedAttachmentUploadService } from './lib/scoped-upload-service'
import { tryResolve } from '@open-mercato/shared/lib/di/tryResolve'
import {
  INTEGRATION_CREDENTIAL_RESOLVER_KEY,
  type IntegrationCredentialResolver,
} from '@open-mercato/shared/modules/integrations/credential-resolution'

export function register(container: AppContainer) {
  container.register({
    attachmentQuotaRecoveryScheduler: asValue(scheduleAttachmentQuotaRecovery),
    attachmentQuotaService: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      createAttachmentQuotaService(em),
    )
      .scoped()
      .proxy(),
    attachmentTargetAccessService: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new AttachmentTargetAccessService(em),
    )
      .scoped()
      .proxy(),
    attachmentScopedUploadService: asFunction((cradle: {
      em: ConstructorParameters<typeof StorageDriverFactory>[0]
      dataEngine: DataEngine
      storageDriverFactory: StorageDriverFactory
      attachmentQuotaService: AttachmentQuotaService
      attachmentQuotaRecoveryScheduler: typeof scheduleAttachmentQuotaRecovery
    }) => new ScopedAttachmentUploadService({
      em: cradle.em,
      dataEngine: cradle.dataEngine,
      storageDriverFactory: cradle.storageDriverFactory,
      attachmentQuotaService: cradle.attachmentQuotaService,
      attachmentQuotaRecoveryScheduler: cradle.attachmentQuotaRecoveryScheduler,
      credentialResolver: tryResolve<IntegrationCredentialResolver>(
        { resolve: (name: string) => (cradle as Record<string, unknown>)[name] },
        INTEGRATION_CREDENTIAL_RESOLVER_KEY,
      ),
    }))
      .scoped()
      .proxy(),
    storageDriverFactory: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new StorageDriverFactory(em),
    )
      .singleton()
      .proxy(),
  })
}
