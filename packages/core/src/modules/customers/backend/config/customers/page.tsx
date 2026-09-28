import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import CustomersConfigurationSections from '../../../components/CustomersConfigurationSections'

export default async function CustomersConfigurationPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string | string[] }
}) {
  const { translate } = await resolveTranslations()
  const returnTo = typeof searchParams?.returnTo === 'string' && searchParams.returnTo.trim().length
    ? searchParams.returnTo.trim()
    : null

  return (
    <Page>
      <PageHeader
        title={translate('customers.config.nav.customers', 'Customers')}
        actions={returnTo ? (
          <Button asChild variant="outline">
            <Link href={returnTo}>
              {translate('common.back', 'Back')}
            </Link>
          </Button>
        ) : undefined}
      />
      <PageBody>
        <div className="space-y-8">
          <CustomersConfigurationSections />
        </div>
      </PageBody>
    </Page>
  )
}
