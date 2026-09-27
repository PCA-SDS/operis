/**
 * The calendar's chrome treatment, declared once for every control that wears it.
 *
 * Four surfaces paint chrome — the header row, the scope row, the category tabs
 * and the event cards — and they had drifted into three different looks for the
 * same job: `outline` buttons with a hairline and a `shadow-sm` lift, `ghost`
 * buttons with neither, and a `SegmentedControl` with a hairline but no lift.
 * Standing side by side on one bar, that reads as controls borrowed from three
 * different products.
 *
 * The rule these constants encode:
 * - **No borders, no shadows.** Every chrome control is flat. Hierarchy comes
 *   from FILL instead — filled primary (New event), raised white (New task,
 *   Filter), transparent (everything else). Three ranks, no lines.
 * - **One ink.** Every resting label is `--foreground` (#1D2735), the
 *   near-black. Muted ink is reserved for content — dates, durations, counts —
 *   not for a control the user is meant to click.
 *
 * The two inversions are NOT exceptions: `New event` and a segmented control's
 * SELECTED item sit on a saturated fill (the blue primary, the near-black
 * pill), where near-black ink would be unreadable. They take the fill's own
 * foreground.
 */

/**
 * A control that keeps its white `bg-surface` fill but drops the hairline and
 * the lift. `border-transparent` rather than `border-0` on purpose: several of
 * these primitives size themselves as `height − 2px border − padding`, so
 * removing the WIDTH shifts their interior geometry instead of just hiding the
 * line.
 */
export const CHROME_FLAT_CONTROL = 'border-transparent shadow-none'
