'use client'

import { MapPin } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { LABEL_CLASS } from '../../calendar/editor/inputs'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

interface LocationFieldProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  location: string
  setLocation: (value: string) => void
}

export function LocationField({
  visible,
  activityType,
  location,
  setLocation,
}: LocationFieldProps) {
  const t = useT()

  if (!isVisible(activityType, 'location')) return null

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="schedule-location" className={LABEL_CLASS}>
        {getFieldLabel(activityType, 'location', t, 'customers.schedule.location', 'Location')}
      </label>
      <Input
        id="schedule-location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder={t('customers.schedule.locationPlaceholder', 'Add location or meeting link...')}
        leftIcon={<MapPin />}
      />
    </div>
  )
}
