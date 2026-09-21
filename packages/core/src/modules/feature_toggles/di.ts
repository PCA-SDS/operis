import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheService } from '@open-mercato/cache'
import { FeatureTogglesService } from './lib/feature-flag-check'

export function register(container: AppContainer) {
  container.register({
    featureTogglesService: asFunction(({ cache, em }: { cache: CacheService; em: EntityManager }) =>
      new FeatureTogglesService(cache, em),
    ).proxy().scoped(),
  })
}
