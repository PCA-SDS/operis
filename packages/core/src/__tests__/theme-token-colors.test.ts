import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Every UI surface follows the light/dark switch, which only works when colour comes from the
 * theme tokens (`bg-surface`, `text-foreground`, `text-status-error-text`, `var(--border)`, …).
 * A Tailwind palette class, a fixed white panel, an arbitrary hex class or a hex inline style
 * paints the same colour in both themes, and the usual result is light text on a white panel
 * in dark mode. This guard fails on each of those shapes anywhere in UI source.
 *
 * Emails are out of scope: mail clients have no theme switch, so templates carry literal colours.
 * A colour that must NOT follow the theme (brand art, a switch thumb that is white in both
 * themes) is listed in ALLOWED with the reason.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const ROOTS = ['packages', 'apps/mercato/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__integration__', 'emails', 'generated', '.mercato'])
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\.generated\.ts$|\.d\.ts$/

const RULES: Array<{ id: string; pattern: RegExp; tsxOnly?: boolean }> = [
  {
    id: 'tailwind-palette',
    pattern: /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  },
  { id: 'fixed-white-or-black', pattern: /\b(?:bg-white|border-white|text-black|border-black)\b|\bbg-black(?!\/)\b/ },
  { id: 'arbitrary-colour-class', pattern: /-\[(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/ },
  { id: 'hsl-around-hex-token', pattern: /hsl\(var\(--/ },
  { id: 'dark-override', pattern: /\bdark:(?!prose-invert\b)[a-z]/ },
  {
    id: 'hex-inline-style',
    pattern: /\b(?:color|backgroundColor|borderColor|background|fill|stroke)\s*:\s*['"`](?:#[0-9a-fA-F]{3,8}|rgba?\()/,
    tsxOnly: true,
  },
]

const ALLOWED: Record<string, string> = {
  'packages/ai-assistant/src/frontend/components/AiDot/AiDot.tsx':
    'The AI orb is brand art: its gradient is the same in both themes, like the brand tokens.',
  'packages/ui/src/primitives/switch.tsx': 'A switch thumb is white in both themes, as on Apple platforms.',
  'packages/ui/src/primitives/fancy-button.tsx': 'The neutral FancyButton is a fixed black button in both themes.',
  'packages/ui/src/backend/DataTable.tsx':
    'The list card takes a hairline in dark mode only, where its shadow no longer separates it from the page.',
  'packages/ui/src/primitives/button.tsx': 'The invalid-state ring keeps its shadcn dark opacity; focus rings are off product-wide.',
  'apps/mercato/src/components/DemoFeedbackWidget.tsx': 'Its gradient is fixed and light, so the label is pinned to black.',
  'packages/checkout/src/modules/checkout/components/LinkTemplateForm.tsx':
    "A pay link's default merchant colours are saved with the link; they are data, not UI chrome.",
  'packages/core/src/modules/customers/components/detail/ManageTagsDialog.tsx':
    "A new tag's default colour is saved with the tag; it is data, not UI chrome.",
}

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry) && !SKIP_FILE.test(entry)) files.push(full)
  }
}

function isComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')
}

function collectUiFiles(): string[] {
  const files: string[] = []
  for (const root of ROOTS) {
    const base = join(repoRoot, root)
    if (root === 'packages') {
      for (const pkg of readdirSync(base)) {
        const src = join(base, pkg, 'src')
        try {
          if (statSync(src).isDirectory()) walk(src, files)
        } catch {
          continue
        }
      }
    } else {
      walk(base, files)
    }
  }
  return files
}

describe('UI colour follows the theme tokens', () => {
  const files = collectUiFiles()

  it('scans the UI source of every package and the app', () => {
    expect(files.length).toBeGreaterThan(1000)
  })

  it('paints nothing that stays the same colour in light and dark', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(repoRoot, file).split(sep).join('/')
      if (ALLOWED[rel]) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const [index, line] of lines.entries()) {
        if (isComment(line)) continue
        for (const rule of RULES) {
          if (rule.tsxOnly && !rel.endsWith('.tsx')) continue
          const match = line.match(rule.pattern)
          if (match) violations.push(`${rel}:${index + 1} [${rule.id}] ${match[0]}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('lists no allowance for a file that no longer needs one', () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      let source: string
      try {
        source = readFileSync(join(repoRoot, rel), 'utf8')
      } catch {
        return true
      }
      const lines = source.split('\n').filter((line) => !isComment(line))
      return !lines.some((line) => RULES.some((rule) => (!rule.tsxOnly || rel.endsWith('.tsx')) && rule.pattern.test(line)))
    })
    expect(stale).toEqual([])
  })
})
