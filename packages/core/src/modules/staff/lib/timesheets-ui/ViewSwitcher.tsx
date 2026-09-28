"use client"

import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ViewMode = 'weekly' | 'monthly'
type ViewType = 'timesheet' | 'list'

interface ViewSwitcherProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  viewType: ViewType
  onViewTypeChange: (type: ViewType) => void
}

/**
 * The period and view switchers, as the shared `SegmentedControl` draws every
 * switcher in the product. They were two bordered rails of buttons whose
 * selected one took the blue primary fill, a switcher that looked like no other.
 */
export function ViewSwitcher({ viewMode, onViewModeChange, viewType, onViewTypeChange }: ViewSwitcherProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-4">
      <SegmentedControl
        value={viewMode}
        onValueChange={(value) => onViewModeChange(value as ViewMode)}
        aria-label={t('staff.timesheets.my.viewMode.ariaLabel', 'Period')}
      >
        <SegmentedControlItem value="weekly">
          {t('staff.timesheets.my.viewMode.weekly', 'Weekly')}
        </SegmentedControlItem>
        <SegmentedControlItem value="monthly">
          {t('staff.timesheets.my.viewMode.monthly', 'Monthly')}
        </SegmentedControlItem>
      </SegmentedControl>

      <SegmentedControl
        value={viewType}
        onValueChange={(value) => onViewTypeChange(value as ViewType)}
        aria-label={t('staff.timesheets.my.viewType.ariaLabel', 'View')}
      >
        <SegmentedControlItem value="timesheet">
          {t('staff.timesheets.my.viewType.timesheet', 'Timesheet')}
        </SegmentedControlItem>
        <SegmentedControlItem value="list">
          {t('staff.timesheets.my.viewType.list', 'List view')}
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}
