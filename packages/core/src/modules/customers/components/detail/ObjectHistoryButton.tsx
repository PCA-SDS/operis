'use client'

import * as React from 'react'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryConfig } from '@open-mercato/ui/backend/version-history'

export type ObjectHistoryButtonProps = {
  resourceKind: VersionHistoryConfig['resourceKind']
  resourceId: VersionHistoryConfig['resourceId']
  resourceIdFallback?: VersionHistoryConfig['resourceIdFallback']
  organizationId?: VersionHistoryConfig['organizationId']
  includeRelated?: VersionHistoryConfig['includeRelated']
  /** `outline` (default) keeps the bordered 32px button; `soft` is the 36px soft icon button. */
  tone?: 'outline' | 'soft'
}

const OUTLINE_ICON_BUTTON_CLASSES =
  'size-8 rounded-md border bg-surface shadow-xs hover:bg-accent hover:text-accent-foreground'

export function ObjectHistoryButton({
  resourceKind,
  resourceId,
  resourceIdFallback,
  organizationId,
  includeRelated,
  tone = 'outline',
}: ObjectHistoryButtonProps) {
  const t = useT()
  const config = React.useMemo<VersionHistoryConfig>(
    () => ({
      resourceKind,
      resourceId,
      resourceIdFallback,
      organizationId,
      includeRelated,
    }),
    [resourceKind, resourceId, resourceIdFallback, organizationId, includeRelated],
  )

  return (
    <VersionHistoryAction
      config={config}
      t={t}
      buttonClassName={tone === 'soft' ? undefined : OUTLINE_ICON_BUTTON_CLASSES}
      buttonVariant={tone === 'soft' ? 'soft' : 'ghost'}
      buttonSize={tone === 'soft' ? 'lg' : 'default'}
    />
  )
}

export default ObjectHistoryButton
