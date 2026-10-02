import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { StatusSettings } from '../../../components/StatusSettings'
import { TaxRatesSettings } from '../../../components/TaxRatesSettings'
import { DocumentNumberSettings } from '../../../components/DocumentNumberSettings'
import { OrderEditingSettings } from '../../../components/OrderEditingSettings'
import { ShippingMethodsSettings } from '../../../components/ShippingMethodsSettings'
import { PaymentMethodsSettings } from '../../../components/PaymentMethodsSettings'
import { AdjustmentKindSettings } from '../../../components/AdjustmentKindSettings'
import { resolveReturnToParam } from '@open-mercato/shared/lib/navigation/returnTo'

export default async function SalesConfigurationPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string | string[] }
}) {
  const { translate } = await resolveTranslations()
  const returnTo = resolveReturnToParam(searchParams)

  return (
    <Page>
      <PageBody className="space-y-8">
        {returnTo ? (
          <Button asChild variant="outline" size="sm">
            <Link href={returnTo}>
              {translate('common.back', 'Back')}
            </Link>
          </Button>
        ) : null}
        <StatusSettings />
        <AdjustmentKindSettings />
        <ShippingMethodsSettings />
        <PaymentMethodsSettings />
        <TaxRatesSettings />
        <OrderEditingSettings />
        <DocumentNumberSettings />
      </PageBody>
    </Page>
  )
}
