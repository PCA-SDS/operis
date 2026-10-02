import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DictionariesManager } from '../../../components/DictionariesManager'
import { resolveReturnToParam } from '@open-mercato/shared/lib/navigation/returnTo'

export default async function DictionariesConfigurationPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string | string[] }
}) {
  const { translate } = await resolveTranslations()
  const returnTo = resolveReturnToParam(searchParams)

  return (
    <Page>
      <PageHeader
        title={translate('dictionaries.config.nav.title', 'Dictionaries')}
        actions={returnTo ? (
          <Button asChild variant="outline">
            <Link href={returnTo}>{translate('common.back', 'Back')}</Link>
          </Button>
        ) : undefined}
      />
      <PageBody className="space-y-8">
        <DictionariesManager />
      </PageBody>
    </Page>
  )
}
