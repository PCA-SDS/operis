import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VIEWPORT_BOTTOM_GUTTER_PX } from '../useAvailableHeight'

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..')

/**
 * The calendar measures the gap under its grid itself; every other locked page
 * (`<Page fill>`) gets it from the shell's rule in `globals.css`. The two must
 * agree, or the calendar's grid ends on a different line from the chat and task
 * cards.
 */
describe('locked page bottom gap', () => {
  it('is the calendar gap in every breakpoint of the shell rule', () => {
    const css = readFileSync(join(repoRoot, 'apps/mercato/src/app/globals.css'), 'utf8')
    const rules = css.match(/\[data-fill='(?:true|sm|md|lg)'\]\) > main \{[^}]*\}/g) ?? []
    expect(rules).toHaveLength(4)
    for (const rule of rules) {
      expect(rule).toContain(`padding-bottom: ${VIEWPORT_BOTTOM_GUTTER_PX / 16}rem !important;`)
    }
  })
})
