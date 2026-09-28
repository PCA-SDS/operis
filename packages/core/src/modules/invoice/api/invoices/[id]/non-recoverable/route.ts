import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoiceNonRecoverableUpdateSchema } from '../../../../data/validators'
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
    schema: invoiceNonRecoverableUpdateSchema,
    commandId: 'invoice.invoices.update-non-recoverable',
    errorLabel: 'update invoice non-recoverable state',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update AR invoice non-recoverable state',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'non-recoverable.update'),
      summary: 'Update AR invoice non-recoverable state',
      description:
        'Marks or clears the non-recoverable state on a scoped AR invoice. A reason is required when marking an invoice non-recoverable, and settled invoices are rejected. ' +
        'Uses optimistic locking and preserves the audit note and timestamp on the invoice.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceNonRecoverableUpdateSchema },
      responses: [
        { status: 200, description: 'Non-recoverable state updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}
