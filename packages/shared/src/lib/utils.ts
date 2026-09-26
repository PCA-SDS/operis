import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `text-overline` is a CUSTOM utility (declared with `@utility` in globals.css,
 * 11px/1rem) and tailwind-merge cannot know that from the class name alone. Out
 * of the box it classifies `text-<word>` as a text COLOUR, so `text-overline`
 * never displaced a component's own size — a `<Button className="text-overline">`
 * kept the button base's `text-sm` and silently rendered the overline at 14px,
 * larger than the 12px rows it was labelling.
 *
 * Registering it in the `font-size` class group is what makes the merge resolve:
 * the later class wins, as it already does for every size on the stock scale.
 * This is the single place that knowledge belongs — a local workaround (an
 * arbitrary `text-[11px]`, or raising the utility's specificity in CSS) would
 * have to be repeated at every call site and would drift.
 *
 * `text-large-title` (the page-title step of the type scale) is registered for
 * the same reason.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-overline', 'text-large-title'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function slugifyTagLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(?:^-+|-+$)/g, "")
      .slice(0, 80) || `tag-${Math.random().toString(36).slice(2, 10)}`
  )
}
