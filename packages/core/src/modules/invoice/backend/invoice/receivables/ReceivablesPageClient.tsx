'use client'
import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { InvoiceList } from '../InvoiceList'
import { InstallmentsDialog } from '../components/InstallmentsDialog'
export function ReceivablesPageClient() {
  const router = useRouter(); const searchParams = useSearchParams(); const installmentsId = searchParams.get('installmentsId')
  const close = () => { const params = new URLSearchParams(searchParams.toString()); params.delete('installmentsId'); router.push(`?${params}`) }
  return <><InvoiceList direction="AR" />{installmentsId && <InstallmentsDialog invoiceId={installmentsId} onClose={close} onChanged={() => router.refresh()} />}</>
}
