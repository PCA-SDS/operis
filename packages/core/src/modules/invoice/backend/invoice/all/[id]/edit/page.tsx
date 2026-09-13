'use client'

import * as React from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InvoiceForm, type InvoiceFormValues } from '../../../InvoiceForm'

export default function EditInvoicePage() {
  const t = useT(); const router = useRouter(); const params = useParams<{ id?: string }>(); const pathname = usePathname(); const id = params.id ?? pathname.split('/').filter(Boolean).at(-2)
  const [record, setRecord] = React.useState<Partial<InvoiceFormValues> | null>(null); const [state, setState] = React.useState('loading')
  React.useEffect(() => { void apiCall<Partial<InvoiceFormValues>>(`/api/invoice/invoices/${id}`).then((call) => { if (call.status === 404) setState('notFound'); else if (!call.ok || !call.result) setState('error'); else { setRecord(call.result); setState('ready') } }) }, [id])
  if (state === 'loading') return <Page><PageBody><LoadingMessage label={t('invoice.detail.loading')} /></PageBody></Page>
  if (state === 'notFound') return <Page><PageBody><ErrorMessage label={t('invoice.detail.notFound')} /></PageBody></Page>
  if (state !== 'ready' || !record) return <Page><PageBody><ErrorMessage label={t('invoice.detail.error')} /></PageBody></Page>
  return <Page><PageBody><InvoiceForm mode="edit" initialValues={record} onSaved={() => router.push(`/backend/invoice/all/${id}`)} /></PageBody></Page>
}
