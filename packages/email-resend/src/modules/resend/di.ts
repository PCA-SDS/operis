import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resendHealthCheck } from './lib/health'
import { createResendEmailService } from './lib/sender'

export function register(container: AppContainer): void {
  container.register({
    resendHealthCheck: asValue(resendHealthCheck),
    resendEmailService: asFunction(({ integrationCredentialsService, integrationStateService }) =>
      createResendEmailService(integrationCredentialsService, integrationStateService),
    ).scoped().proxy(),
  })
}
