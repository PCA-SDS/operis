import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { invoiceDueDateUpdateSchema } from '../../../../data/validators'
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
    schema: invoiceDueDateUpdateSchema,
    commandId: 'invoice.invoices.update-due-date',
    errorLabel: 'update invoice due date',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: invoiceInvoicesTag,
  summary: 'Update invoice due date',
  methods: {
    PATCH: {
      operationId: createInvoiceOperationId('invoices', 'due-date.update'),
      summary: 'Update invoice due date',
      description:
        'Sets or clears the due date on a scoped invoice. Works for both MANUAL and imported invoices. ' +
        'Imported tax data is never touched. Updates nextDueDate when no installment plan exists and the invoice is unsettled. ' +
        'Uses optimistic locking.',
      pathParams: invoiceInvoiceParamSchema,
      requestBody: { contentType: 'application/json', schema: invoiceDueDateUpdateSchema },
      responses: [
        { status: 200, description: 'Due date updated', schema: invoiceManualMutationResponseSchema },
      ],
      errors: invoiceInvoiceRouteErrors,
    },
  },
}