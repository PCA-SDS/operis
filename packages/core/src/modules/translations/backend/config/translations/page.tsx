import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TranslationManager, LocaleManager } from '../../../components/TranslationManager'

export default async function TranslationSettingsPage() {
  const { translate } = await resolveTranslations()
  return (
    <Page>
      <PageHeader title={translate('translations.config.nav.title', 'Translations')} />
      <PageBody className="space-y-8">
        <LocaleManager />
        <TranslationManager mode="standalone" />
      </PageBody>
    </Page>
  )
}
