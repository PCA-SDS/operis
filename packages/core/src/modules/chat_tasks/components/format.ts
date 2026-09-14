/** The reader's own timezone, which is what every date rule in the tasks module
 *  resolves against — "today" and "tomorrow" are wall-clock questions. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/** Today in the reader's timezone, as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

/**
 * Plain text as the HTML the task description column actually stores.
 *
 * `tasks_tasks.description` is a rich-text column: the tasks module sanitizes it
 * on write and renders it with `dangerouslySetInnerHTML`. Writing raw plain text
 * into it therefore does two wrong things to a message somebody just reviewed —
 * every line break disappears, because HTML collapses them, and any
 * angle-bracketed word ("deploy <service> first") is read as a tag and stripped by
 * the sanitizer. The task then says something different from the text the writer
 * was shown and approved, which is the one promise this flow makes.
 *
 * So the text is escaped and its line structure is expressed in markup: blank
 * lines become paragraphs, single newlines become breaks. Nothing else is
 * inferred — no links, no lists, no emphasis — because the source is a chat
 * message, not markup, and guessing at formatting would be another way for the
 * stored task to differ from what was reviewed. `descriptionPlaintext` keeps the
 * original characters for search and for anything that wants the text unchanged.
 */
export function plainTextToTaskHtml(value: string): string {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, '<br />'))
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('')
}
