import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoiceSettlementUpdateSchema } from '../../../../data/validators'
import { createInvoiceOperationId } from '../../../openapi'
import {
  invoiceInvoiceParamSchema,
  invoiceInvoiceRouteErrors,
  invoiceInvoiceManageRouteMetadata,
  invoiceInvoicesTag,
  invoiceManualMutationResponseSchema,
} from '../../shared'
import { runInvoiceFieldUpdate, type InvoiceFieldUpdateRouteContext } from '../fieldUpdate'

export const metadata = {
  PATCH: invoiceInvoiceManageRouteMetadata,
}

export async function PATCH(req: Request, routeContext: InvoiceFieldUpdateRouteContext = {}) {
  return runInvoiceFieldUpdate(req, routeContext, {
    schema: invoiceSettlementUpdateSchema,
    commandId: 'invoice.invoices.update-settlement',
    errorLabel: 'update invoice settlement',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update AR invoice settlement',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'settlement.update'),
      summary: 'Update AR invoice settlement',
      description:
        'Settles or unsets settlement on a scoped AR invoice. AP direct settlement is rejected. ' +
        'Installment rows are updated when present, invoice payment rollups are recomputed, and settling clears non-recoverable state. ' +
        'Uses optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceSettlementUpdateSchema },
      responses: [
        { status: 200, description: 'Settlement updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
