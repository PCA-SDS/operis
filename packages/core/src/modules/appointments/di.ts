import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resendHealthCheck } from './lib/resend-health'

export function register(container: AppContainer) {
  container.register({
    resendHealthCheck: asValue(resendHealthCheck),
  })
}
