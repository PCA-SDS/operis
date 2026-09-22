# Calendar — removed features

The calendar was deliberately stripped back to its most basic form: one chrome
row holding the date navigation, a search field and a view switcher — and the
grid itself.

This is the record of what came out, why, and what it costs to put each one
back. Nothing here was removed because it was broken.

**Status:** temporary. Most of these are holds, not deletions — the entries are
ordered cheapest-to-restore first.

---

## 1. Tasks on the calendar — *gated off, code intact*

Tasks no longer appear on the calendar, and the **New task** button is gone from
the header.

Nothing was deleted. `backend/calendar/page.tsx` passes `tasksEnabled={false}`
where it previously passed `moduleIds.has('tasks')`. That one flag is the whole
switch:

- `useCalendarTasks` returns before it fetches and yields no items
- `onNewTask` goes `undefined`, so `CalendarHeader` drops the button
- the task create path returns early

The task-aware code downstream is untouched and simply never sees a task item:
the `isTaskItem` guard in `TimeGrid`, the task category colour, the editor's
task labels.

**To restore:** change `tasksEnabled={false}` back to
`tasksEnabled={moduleIds.has('tasks')}`. One line. No re-integration.

---

## 2. Customization (settings) button — *button only*

The gear that closed the scope row is gone, along with the `onOpenSettings`
prop. (The row it lived on was removed shortly after — see § 6.)

**The modal itself still exists and still works** — `CalendarSettingsModal` is
unchanged and is still mounted by `CalendarScreen`. It is now reachable only by
pressing <kbd>?</kbd>.

> ⚠️ This is the one removal with a discoverability cost. A user who does not
> know the shortcut has no way to reach event categories, activity types, CRM
> activity visibility, AI summaries, conflict warnings or weekend display.

**To restore:** add an `IconButton` to the header's right-hand group and an
`onOpenSettings` prop to `CalendarHeaderProps`. `CalendarScopeBar` no longer
exists to put it back on.

---

## 3. Category tabs: All Scheduled / Meetings / Events — *deleted*

The segmented rail at the head of the scope row, with its per-category counts.

Removed:

| Thing | Location |
|---|---|
| `CalendarTabs` component | `components/calendar/CalendarTabs.tsx` |
| its test | `__tests__/CalendarTabs.test.tsx` |
| `CalendarTab` type | `types.ts` |
| `CalendarTabsProps` | `types.ts` |
| `tab` / `counts` / `onTabChange` | `CalendarScopeBarProps` (since deleted) |
| `tab` state and `tabCounts` | `CalendarScreen` |
| `countByCategory` import | `CalendarScreen` |

The category filter it drove collapsed with it. `viewItems` was:

```ts
if (tab === 'meetings') return baseItems.filter(i => i.category === 'meeting')
if (tab === 'events')   return baseItems.filter(i => i.category === 'event')
return baseItems
```

With no way to select a category, only the last branch was reachable, so
`viewItems` is now just `baseItems`.

`countByCategory` still exists in `lib/calendar/categories.ts` — it has no
caller in the calendar but is referenced by `TC-CAL-004`.

---

## 4. Filter button and its popover — *deleted*

The **Filter** trigger with its active-count badge, and the popover behind it
holding interaction type, status and owner selects with Clear / Apply.

`CalendarToolbar` is now a search field and nothing else. Removed from it:
`filtersOpen` / `pendingFilters` state, `handleFiltersOpenChange`,
`clearFilters`, `applyFilters`, `activeFilterCount`, and the `Popover`,
`Select`, `Badge` and `ListFilter` imports.

> ⚠️ `CalendarToolbarProps` still declares `filters`, `typeOptions`,
> `ownerOptions` and `onFiltersChange`, and `CalendarScreen` still holds
> `filters` state and applies it in `baseItems`. That filtering is now
> unreachable — the state is permanently `EMPTY_FILTERS`. It was left in place
> so restoring the popover does not mean rebuilding the filter pipeline. **If
> the filter is not coming back, this is dead code that should be removed.**

---

## 5. Agenda view — *deleted*

The entire fourth view, and everything that existed only to serve it.

Removed:

| Thing | Location |
|---|---|
| `AgendaList` component + test | `components/calendar/AgendaList.tsx` |
| `UpcomingCards` component + test | `components/calendar/UpcomingCards.tsx` |
| `AgendaListProps` | `types.ts` |
| `'agenda'` from `CalendarView` | `types.ts` |
| `'next7'` and `'next30'` from `CalendarRangePreset` | `types.ts` (type since deleted) |
| Agenda segment in the view switcher | `CalendarHeader` |
| the "Upcoming" title branch | `CalendarHeader` |
| `agendaHorizonDays` state, `DEFAULT_AGENDA_HORIZON_DAYS` | `CalendarScreen` |
| the <kbd>A</kbd> shortcut | `CalendarScreen` keydown handler |
| the <kbd>A</kbd> row in the shortcut legend | `CalendarSettingsModal` |
| `case 'agenda'` in `getVisibleRange` and `shiftAnchor` | `lib/calendar/range.ts` |

**Knock-on changes worth knowing:**

- `getVisibleRange(view, anchor, agendaHorizonDays)` lost its third parameter
  and is now `getVisibleRange(view, anchor)`. Callers in `TimeGrid` and
  `MonthGrid` were passing a placeholder `0` and were updated.
- **Range presets went first, then the whole control.** "Next 7 days" and
  "Next 30 days" existed only to switch into Agenda and set its horizon, so
  they went with it — and the remaining two were removed shortly after along
  with the entire range picker (§ 6). All four `toolbar.presets.*` i18n keys
  are still in the locale files and are now unused.
- The **upcoming-events strip** below the grid went with it. It only rendered
  when `view === 'agenda'`.

This is the most expensive entry to reverse: it is a real rebuild, not a flag.

---

## 6. Range picker and the scope row — *deleted*

The joined **Custom range ⌄ | 📅 Sep 21 – 27, 2026** control: the preset select
and the date-range popover beside it.

Removing it left `CalendarScopeBar` owning nothing but a wrapper, so the
component went too:

| Thing | Location |
|---|---|
| `CalendarScopeBar` component + test | `components/calendar/CalendarScopeBar.tsx` |
| `CalendarScopeBarProps` | `types.ts` |
| `CalendarRangePreset` type | `types.ts` |
| `RANGE_PRESETS`, `presetLabels` | (deleted with the component) |
| `preset` state, `handlePresetChange` | `CalendarScreen` |
| the vertical `Separator` between the two halves | (deleted with the component) |

**The anchor can still be moved** — Today and the prev/next arrows both call
`handleAnchorChange`. What is gone is jumping to an arbitrary date, and the
named presets.

---

## 7. The two chrome rows became one

The calendar had a header row (Today, arrows, date, create, switcher) and a
scope row below it (categories, search, filters, range, settings). With most of
the scope row removed, the remainder was folded into the header:

- `CalendarHeaderProps` gained a `controls` slot, rendered between the date
  cluster and the view switcher.
- `CalendarScreen` passes the status text and `CalendarToolbar` into it.

Layout contract, which a test now pins: the **date cluster hugs** and the
**right-hand group carries `flex-1 justify-end`**. Both halves carried `flex-1`
at first, so they fought for the row and the date lost — it truncated to "T.."
while the controls kept full width.

Final order, left to right: `Today · ‹ · › · date` … `search · New event · Day
Week Month`.

---

## Smaller UI removals

Done in the same pass, listed for completeness:

- **Now-line clock on the time axis.** It painted a `bg-surface` plate over
  whichever hour label it landed on — worst case on the hour, where at 23:00 it
  covered "11 PM" exactly. The line is positioned to the minute and the
  `role="status"` announcement still carries the exact time.
- **Frame border around the grid.** `rounded-lg border border-border bg-surface`
  lost its border on all three view roots. With the deepened page ground the
  white surface already reads as raised. Internal row and column dividers are
  untouched.
- **Keyboard-shortcuts button** in the header. It called `setSettingsOpen(true)`
  — the identical handler the settings gear used — so the header offered a
  second door to one modal. Removed before the gear was.

---

## What the calendar still has

Today · previous/next · the date · Day / Week / Month · search · the grid · the
event editor · the settings modal behind <kbd>?</kbd>.

All of it on one row.
