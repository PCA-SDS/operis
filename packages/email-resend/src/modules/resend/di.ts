import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resendHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  container.register({
    resendHealthCheck: asValue(resendHealthCheck),
  })
}
