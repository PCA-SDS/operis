'use client'

import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InvoiceForm } from '../../InvoiceForm'

export default function CreateInvoicePage() {
  const router = useRouter()
  return <Page><PageBody><InvoiceForm mode="create" onSaved={(id) => router.push(`/backend/invoice/all/${id}`)} /></PageBody></Page>
}
