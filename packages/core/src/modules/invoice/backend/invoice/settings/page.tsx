'use client'

import * as React from 'react'
import { BadgeCheck, CalendarClock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'

import { AutoPaidSettings } from './components/AutoPaidSettings'
import { PartnerTermsSettings } from './components/PartnerTermsSettings'

export default function InvoiceSettingsPage() {
  const t = useT()

  return (
    <Page>
      <PageHeader
        title={t('invoice.settings.title')}
        description={t('invoice.settings.description')}
      />
      <PageBody className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <CalendarClock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{t('invoice.settings.partnerTerms.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('invoice.settings.partnerTerms.description')}</p>
            </div>
          </div>
          <PartnerTermsSettings />
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <BadgeCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{t('invoice.settings.autoPaid.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('invoice.settings.autoPaid.description')}</p>
            </div>
          </div>
          <AutoPaidSettings />
        </section>
      </PageBody>
    </Page>
  )
}
