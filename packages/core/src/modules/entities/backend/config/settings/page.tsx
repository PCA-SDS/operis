import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { EntitySettingsManager } from '../../../components/EntitySettingsManager'

export default async function EntitySettingsPage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageHeader
        title={translate('entities.settings.title', 'Custom Entities')}
        description={translate('entities.settings.description', 'Manage global custom entity configurations.')}
      />
      <PageBody>
        <EntitySettingsManager />
      </PageBody>
    </Page>
  )
}
