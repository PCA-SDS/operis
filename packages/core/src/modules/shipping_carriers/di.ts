import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import { CarrierShipment } from './data/entities'
import { createShippingCarrierService } from './lib/shipping-service'
import { ensureMockCarrierRegistered } from './lib/mock-carrier-registration'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
}

export function register(container: AppContainer) {
  // Test-only: register the network-free `mock_carrier` provider when
  // `OM_ENABLE_MOCK_SHIPPING_CARRIER` is set. A no-op otherwise, so a real
  // deployment cannot quote rates or print labels from a fixture.
  ensureMockCarrierRegistered()

  container.register({
    shippingCarrierService: asFunction(({ em, integrationCredentialsService }: Cradle) =>
      createShippingCarrierService({ em, integrationCredentialsService }),
    ).scoped().proxy(),
    CarrierShipment: asValue(CarrierShipment),
  })
}
