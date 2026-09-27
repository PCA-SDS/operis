import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PriceKindSettings } from '../../../components/PriceKindSettings'
import { UnitPriceDisplaySettings } from '../../../components/UnitPriceDisplaySettings'

export default async function CatalogConfigurationPage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageHeader title={translate('catalog.config.nav.catalog', 'Catalog')} />
      <PageBody className="space-y-8">
        <PriceKindSettings />
        <UnitPriceDisplaySettings />
      </PageBody>
    </Page>
  )
}
