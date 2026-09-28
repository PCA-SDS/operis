import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaimRegistration } from '../data/entities'
import { addWarrantyMonths, computeWarrantyEntitlementPreview } from '../lib/warrantyPreview'
import { resolveEffectiveWarrantyClaimSettings } from '../lib/settings'
import { toValidDateOrNull, toIsoOrEcho } from '@open-mercato/shared/lib/date/normalize'

export interface WarrantyEntitlementInput {
  serialNumber?: string | null
  orderId?: string | null
  productId?: string | null
  variantId?: string | null
  sku?: string | null
  purchaseDate?: string | null
}

export interface WarrantyEntitlementResult {
  warrantyStatus: 'in_warranty' | 'out_of_warranty' | 'unknown'
  coverageType: 'standard' | 'extended' | 'none' | null
  expiresAt: string | null
  source: 'registration' | 'order' | 'manual' | 'resolver' | null
}

export interface WarrantyEntitlementResolver {
  resolveEntitlement(
    input: WarrantyEntitlementInput,
    scope: { tenantId: string; organizationId: string },
    em: EntityManager,
  ): Promise<WarrantyEntitlementResult>
}

const UNKNOWN_ENTITLEMENT: WarrantyEntitlementResult = {
  warrantyStatus: 'unknown',
  coverageType: null,
  expiresAt: null,
  source: null,
}

function resolveStatusFromExpiry(expiresAt: Date | null | undefined, now = new Date()): WarrantyEntitlementResult['warrantyStatus'] {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'unknown'
  return expiresAt.getTime() >= now.getTime() ? 'in_warranty' : 'out_of_warranty'
}

export function createWarrantyEntitlementResolver(): WarrantyEntitlementResolver {
  return {
    async resolveEntitlement(input, scope, em) {
      const serialNumber = input.serialNumber?.trim()

      if (serialNumber) {
        const registration = await findOneWithDecryption(
          em,
          WarrantyClaimRegistration,
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            serialNumber,
            deletedAt: null,
          },
          {},
          scope,
        )

        if (registration) {
          const registrationStatus = resolveStatusFromExpiry(registration.warrantyExpiresAt)
          return {
            warrantyStatus: registrationStatus,
            coverageType: registration.coverageType ?? null,
            // Never pair an indeterminate status with a concrete source/expiry (LINE-04).
            expiresAt: registrationStatus === 'unknown' ? null : toIsoOrEcho(registration.warrantyExpiresAt),
            source: registrationStatus === 'unknown' ? null : 'registration',
          }
        }
      }

      const purchaseDate = toValidDateOrNull(input.purchaseDate)
      if (!purchaseDate) return UNKNOWN_ENTITLEMENT

      const settings = await resolveEffectiveWarrantyClaimSettings(em, scope)
      const warrantyStatus = computeWarrantyEntitlementPreview(purchaseDate, settings.defaultWarrantyMonths)
      const expiresAt = settings.defaultWarrantyMonths === null
        ? null
        : addWarrantyMonths(purchaseDate, settings.defaultWarrantyMonths)

      return {
        warrantyStatus,
        coverageType: null,
        // Never pair an indeterminate status with a concrete source/expiry (LINE-04).
        expiresAt: warrantyStatus === 'unknown' ? null : toIsoOrEcho(expiresAt),
        source: warrantyStatus === 'unknown' ? null : (input.orderId ? 'order' : 'resolver'),
      }
    },
  }
}
