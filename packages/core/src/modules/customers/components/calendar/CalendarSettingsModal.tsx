"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  CalendarPreferences,
  ConflictScope,
  MAX_ACTIVITY_TYPES,
  MAX_EVENT_CATEGORIES,
} from '../../lib/calendar/preferences'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'

/**
 * Every global calendar shortcut, in the order this modal lists them.
 *
 * The keys themselves are bound in `CalendarScreen`; this is the legend. It
 * used to have a dialog of its own, which meant two modals a user could be
 * looking for the same thing in — so it is a section here instead, and `?`
 * opens this modal.
 */
export const CALENDAR_SHORTCUTS: ReadonlyArray<{
  key: string
  labelKey: string
  fallback: string
}> = [
  { key: 'T', labelKey: 'customers.calendar.shortcuts.today', fallback: 'Today' },
  { key: 'D', labelKey: 'customers.calendar.shortcuts.dayView', fallback: 'Day view' },
  { key: 'W', labelKey: 'customers.calendar.shortcuts.week', fallback: 'Week' },
  { key: 'M', labelKey: 'customers.calendar.shortcuts.month', fallback: 'Month' },
  { key: 'A', labelKey: 'customers.calendar.shortcuts.agenda', fallback: 'Agenda' },
  { key: 'N', labelKey: 'customers.calendar.shortcuts.newEvent', fallback: 'New event' },
  { key: '/', labelKey: 'customers.calendar.shortcuts.search', fallback: 'Search' },
  { key: '?', labelKey: 'customers.calendar.shortcuts.help', fallback: 'Shortcuts' },
]

export type CalendarSettingsModalProps = {
  open: boolean
  preferences: CalendarPreferences
  seedActivityTypes: string[]
  onOpenChange(open: boolean): void
  onSave(next: CalendarPreferences): void
}

type ToggleKey = 'showCrmActivities' | 'aiSummaries' | 'conflictWarnings' | 'showWeekends'

// An empty Activity Types list is an intentional floor meaning "surface all
// dictionary types" rather than "surface none". When the stored list is empty
// the modal seeds the dictionary types for display. NOTE: since the editor's
// Category quick-pick was removed (owner feedback, #3552) these lists no longer
// affect the event editor — the type switcher always shows the full dictionary.
function buildDraft(preferences: CalendarPreferences, seedActivityTypes: string[]): CalendarPreferences {
  return {
    ...preferences,
    eventCategories: [...preferences.eventCategories],
    activityTypes:
      preferences.activityTypes.length > 0
        ? [...preferences.activityTypes]
        : seedActivityTypes.slice(0, MAX_ACTIVITY_TYPES),
  }
}

export function CalendarSettingsModal({
  open,
  preferences,
  seedActivityTypes,
  onOpenChange,
  onSave,
}: CalendarSettingsModalProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<CalendarPreferences>(() => buildDraft(preferences, seedActivityTypes))
  const openRef = React.useRef(false)

  React.useEffect(() => {
    if (open && !openRef.current) setDraft(buildDraft(preferences, seedActivityTypes))
    openRef.current = open
  }, [open, preferences, seedActivityTypes])

  const handleSave = React.useCallback(() => {
    onSave(draft)
    onOpenChange(false)
  }, [draft, onOpenChange, onSave])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave })

  const toggle = (key: ToggleKey) => (checked: boolean) => setDraft((current) => ({ ...current, [key]: checked }))

  const toggleRows: Array<{ key: ToggleKey; label: string }> = [
    { key: 'showCrmActivities', label: t('customers.calendar.settings.showCrmActivities', 'Show CRM activities on calendar') },
    { key: 'aiSummaries', label: t('customers.calendar.settings.aiSummaries', 'AI summaries & quick actions') },
    { key: 'conflictWarnings', label: t('customers.calendar.settings.conflictWarnings', 'Conflict warnings') },
    { key: 'showWeekends', label: t('customers.calendar.settings.showWeekends', 'Show weekends') },
  ]

  const title = t('customers.calendar.settings.title', 'Customization')
  const removeTagLabel = React.useCallback(
    (tag: string) => t('customers.calendar.settings.removeTag', 'Remove {tag}', { tag }),
    [t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={handleKeyDown}
        closeAriaLabel={t('customers.calendar.settings.close', 'Close')}
        // Same shell as the event editor: a `size` variant rather than a width
        // class, the DS header band with nothing drawn under it, and a footer
        // with nothing drawn above it. `lg` rather than the editor's `xl` —
        // this is a single column of settings, and it now carries the shortcut
        // legend that used to have a modal to itself.
        size="lg"
        className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-h-[calc(100dvh-4rem)]"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('customers.calendar.settings.subtitle', 'Customise your calendar module.')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <SettingsTagInput
            label={t('customers.calendar.settings.eventCategories', 'Event Categories')}
            maxLabel={t('customers.calendar.settings.max', '(max. {count})', { count: MAX_EVENT_CATEGORIES })}
            hint={t(
              'customers.calendar.settings.eventCategoriesHint',
              'Your own grouping labels (e.g. Team Meeting, Sales Call). Offered when creating an event.',
            )}
            placeholder={t('customers.calendar.settings.addCategory', 'Add a category…')}
            value={draft.eventCategories}
            maxTags={MAX_EVENT_CATEGORIES}
            removeTagLabel={removeTagLabel}
            onChange={(eventCategories) => setDraft((current) => ({ ...current, eventCategories }))}
          />
          <SettingsTagInput
            label={t('customers.calendar.settings.activityTypes', 'Activity Types')}
            maxLabel={t('customers.calendar.settings.max', '(max. {count})', { count: MAX_ACTIVITY_TYPES })}
            hint={t(
              'customers.calendar.settings.activityTypesHint',
              'The activity types your calendar surfaces when creating an event. Seeded from your workspace dictionary.',
            )}
            placeholder={t('customers.calendar.settings.addType', 'Add a type…')}
            value={draft.activityTypes}
            maxTags={MAX_ACTIVITY_TYPES}
            removeTagLabel={removeTagLabel}
            onChange={(activityTypes) => setDraft((current) => ({ ...current, activityTypes }))}
          />
          {toggleRows.map((row) => (
            <React.Fragment key={row.key}>
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft[row.key]}
                  onCheckedChange={toggle(row.key)}
                  aria-label={row.label}
                />
                <span className="text-sm leading-5 text-foreground">{row.label}</span>
              </div>
              {row.key === 'conflictWarnings' && draft.conflictWarnings ? (
                <div className="flex flex-col gap-1.5 pl-11">
                  <span className="text-xs leading-4 text-muted-foreground">
                    {t(
                      'customers.calendar.settings.conflictScopeHint',
                      'Choose whose overlaps the calendar flags as conflicts.',
                    )}
                  </span>
                  <SegmentedControl
                    fullWidth
                    aria-label={t('customers.calendar.settings.conflictScope', 'Conflict scope')}
                    value={draft.conflictScope}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, conflictScope: value as ConflictScope }))
                    }
                  >
                    <SegmentedControlItem value="mine">
                      {t('customers.calendar.settings.conflictScopeMine', 'My meetings')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="all">
                      {t('customers.calendar.settings.conflictScopeAll', 'All meetings')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                </div>
              ) : null}
            </React.Fragment>
          ))}
          {/* The shortcut legend, folded in from the dialog it used to own. It
              is reference rather than a setting, so it closes the body under a
              heading instead of sitting among the controls. */}
          <section className="flex flex-col gap-2 pt-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t('customers.calendar.shortcuts.title', 'Keyboard shortcuts')}
            </h3>
            <ul className="flex flex-col gap-2">
              {CALENDAR_SHORTCUTS.map((shortcut) => (
                <li key={shortcut.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm leading-5 text-foreground">
                    {t(shortcut.labelKey, shortcut.fallback)}
                  </span>
                  <Kbd>{shortcut.key}</Kbd>
                </li>
              ))}
            </ul>
          </section>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('customers.calendar.settings.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('customers.calendar.settings.save', 'Save Changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type SettingsTagInputProps = {
  label: string
  maxLabel: string
  hint: string
  placeholder: string
  value: string[]
  maxTags: number
  removeTagLabel: (tag: string) => string
  onChange(value: string[]): void
}

function SettingsTagInput({ label, maxLabel, hint, placeholder, value, maxTags, removeTagLabel, onChange }: SettingsTagInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium leading-5 text-foreground">{label}</span>
        <span className="text-sm leading-5 text-muted-foreground">{maxLabel}</span>
        <SimpleTooltip content={hint}>
          <span className="inline-flex text-muted-foreground" tabIndex={0} role="img" aria-label={hint}>
            <Info aria-hidden className="size-4" />
          </span>
        </SimpleTooltip>
      </div>
      <TagInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxTags={maxTags}
        aria-label={label}
        removeTagLabel={removeTagLabel}
      />
    </div>
  )
}
