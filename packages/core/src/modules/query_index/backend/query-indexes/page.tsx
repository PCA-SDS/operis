import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import QueryIndexesTable from '../../components/QueryIndexesTable'
import { resolveReturnToParam } from '@open-mercato/shared/lib/navigation/returnTo'

export default async function QueryIndexesPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string | string[] }
}) {
  const { translate } = await resolveTranslations()
  const returnTo = resolveReturnToParam(searchParams)

  return (
    <Page>
      <PageBody>
        <div className="space-y-8">
          {returnTo ? (
            <Button asChild variant="outline" size="sm">
              <Link href={returnTo}>
                {translate('common.back', 'Back')}
              </Link>
            </Button>
          ) : null}
          <QueryIndexesTable />
        </div>
      </PageBody>
    </Page>
  )
}

