import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/dictionary_entry'
import { makeStatusDictionaryRoute } from '../../lib/makeStatusDictionaryRoute'

/**
 * `adjustment-kind` is a `SalesDictionaryKind` like the status dictionaries, so
 * this goes through the same factory.
 *
 * It used to be a hand-copy of it, which had re-introduced the bug the factory's
 * `resolveSalesDictionaryForCandidates` exists to prevent: the copy looped over
 * candidate organizations calling `ensureSalesDictionary`, which *creates and
 * flushes* a `Dictionary` when none exists — so it always returned on the first
 * candidate. A plain GET could therefore INSERT a row, and under an
 * "all organizations" scope it would create an empty dictionary on the actor's
 * own org and return an empty list while populated kinds sat in another org.
 *
 * The read gate stays `sales.orders.view` — the adjustment-kind picker is
 * reachable from the order screens, unlike the settings-only status pickers.
 */
const route = makeStatusDictionaryRoute({
  kind: 'adjustment-kind',
  entityId: E.dictionaries.dictionary_entry,
  fieldConstants: F,
  features: { view: 'sales.orders.view', manage: 'sales.settings.manage' },
  indexer: { entityType: E.dictionaries.dictionary_entry },
  openApi: {
    resourceName: 'Sales adjustment kind',
    pluralName: 'Sales adjustment kinds',
    description: 'Manage the adjustment kinds available on sales documents.',
  },
})

export const metadata = route.metadata
export const openApi = route.openApi
export const GET = route.GET
export const POST = route.POST
export const PUT = route.PUT
export const DELETE = route.DELETE
