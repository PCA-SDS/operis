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
 * SELECTED item both sit on a saturated navy fill, where near-black ink would
 * be unreadable. They take the fill's own foreground.
 */

/**
 * A control that keeps its white `bg-surface` fill but drops the hairline and
 * the lift. `border-transparent` rather than `border-0` on purpose: several of
 * these primitives size themselves as `height − 2px border − padding`, so
 * removing the WIDTH shifts their interior geometry instead of just hiding the
 * line.
 */
export const CHROME_FLAT_CONTROL = 'border-transparent shadow-none'

/**
 * A `SegmentedControl` track wearing the chrome treatment. The track carries a
 * border for its own geometry (`h-9 − 2px border − 8px padding = 26px item`),
 * so only the colour is dropped — see the note above.
 */
export const CHROME_SEGMENTED_TRACK = 'border-transparent'

/**
 * A `SegmentedControlItem` wearing the chrome ink. The primitive inks unchecked
 * items `text-muted-foreground`, which left the unselected segments two steps
 * lighter than every button beside them. Only the UNCHECKED state is overridden
 * — the checked item keeps `text-sidebar-foreground`, because it is sitting on
 * the navy pill.
 */
export const CHROME_SEGMENTED_ITEM = 'data-[state=unchecked]:text-foreground'

/**
 * A bare icon affordance: a glyph and nothing else, at rest AND on hover.
 *
 * `IconButton` has no variant that stays unpainted — `ghost` tints on hover,
 * `modifiable` tints on hover, `white` is filled from the start — so the
 * treatment is composed here rather than by adding a fourth variant to a
 * primitive the whole product shares. Every hover surface is neutralised
 * explicitly, including the `dark:` one: `hover:bg-transparent` and
 * `dark:hover:bg-*` are different variant keys to tailwind-merge, so cancelling
 * the first leaves the second alive and the button would still light up in dark
 * mode.
 *
 * Pair it with `variant="ghost"`, which is the only variant that starts unpainted.
 */
export const CHROME_BARE_ICON =
  'bg-transparent shadow-none text-foreground ' +
  'hover:bg-transparent hover:text-foreground dark:hover:bg-transparent'
