/**
 * Default kanban lane width in pixels (matches SPEC-048 Figma node 982:335). Operators can
 * override per-lane via the drag-resize handle; this constant is the fallback used when no
 * override is recorded.
 *
 * Centralised here so the value can't drift between the Lane wrapper, the AddStageLane CTA,
 * and the page-level DragOverlay — three places that previously hand-wrote `w-[308px]` and
 * `style={{ width: '308px' }}` independently.
 */
export const LANE_WIDTH_PX = 308

/**
 * Tailwind utility class encoding `LANE_WIDTH_PX`. Use this in `className` templates;
 * use `LANE_WIDTH_PX` in inline `style` blocks where the width is genuinely dynamic.
 */
export const LANE_WIDTH_CLASS = 'w-[308px]'

/**
 * Currency-breakdown formatters. The lane footer, the breakdown table and the
 * filter popover render the same deal totals side by side, so a rounding or
 * grouping change in one copy silently disagreed with the other two in the same
 * viewport — which reads as a data bug, not a formatting one.
 */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Math.round(amount))
}

export function formatToday(): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date())
}
