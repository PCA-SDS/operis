import fs from 'node:fs'
import path from 'node:path'

/**
 * The nine React Flow node components and the card they share.
 *
 * Seven of them painted their connection handles with a literal `#0080FE` and
 * `border-white`, while `ParallelForkNode`/`ParallelJoinNode` used
 * `bg-primary`/`border-background` — so the same canvas rendered two different
 * blues, in light mode as well as dark. Neither `om-ds/no-hardcoded-status-colors`
 * nor the sibling dialog guard catches it: the lint rule is scoped to
 * backend-scoped globs only (this is `components/`) and it matches Tailwind ramp
 * names only, never a hex literal.
 */
const nodeFiles = [
  'src/modules/workflows/components/WorkflowNodeCard.tsx',
  'src/modules/workflows/components/nodes/StartNode.tsx',
  'src/modules/workflows/components/nodes/EndNode.tsx',
  'src/modules/workflows/components/nodes/AutomatedNode.tsx',
  'src/modules/workflows/components/nodes/UserTaskNode.tsx',
  'src/modules/workflows/components/nodes/SubWorkflowNode.tsx',
  'src/modules/workflows/components/nodes/WaitForTimerNode.tsx',
  'src/modules/workflows/components/nodes/WaitForSignalNode.tsx',
  'src/modules/workflows/components/nodes/ParallelForkNode.tsx',
  'src/modules/workflows/components/nodes/ParallelJoinNode.tsx',
]

const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: 'hex colour literal', pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { label: 'rgb()/rgba() literal', pattern: /\brgba?\(/ },
  { label: 'border-white / bg-white', pattern: /\b(?:border|bg)-white\b/ },
  { label: 'border-black / bg-black', pattern: /\b(?:border|bg)-black\b/ },
  // Arbitrary COLOUR values only. `WorkflowNodeCard`'s `w-[280px]` is a
  // deliberate fixed canvas-node width with no DS-scale equivalent (the scale
  // jumps 256px → 288px), so a blanket arbitrary-value rule does not belong here.
  { label: 'arbitrary colour value', pattern: /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to)-\[[^\]]*(?:#|rgb|hsl)[^\]]*\]/ },
]

function findViolations(filePath: string): string[] {
  const source = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8')
  return source.split('\n').flatMap((line, index) =>
    forbiddenPatterns
      .filter(({ pattern }) => pattern.test(line))
      .map(({ label }) => `${filePath}:${index + 1} ${label}: ${line.trim()}`),
  )
}

describe('workflow graph node DS compliance', () => {
  test.each(nodeFiles)('%s uses semantic tokens, not literal colours', (filePath) => {
    expect(findViolations(filePath)).toEqual([])
  })

  it('paints every connection handle with the same tokens', () => {
    // The defect was divergence, not any single value: two node families used
    // different handle styling on one canvas.
    const handleClassNames = new Set<string>()
    for (const filePath of nodeFiles) {
      const source = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8')
      for (const match of source.matchAll(/className="(![^"]*?w-3[^"]*?)"/g)) {
        handleClassNames.add(match[1])
      }
    }
    expect(handleClassNames.size).toBeGreaterThan(0)
    expect([...handleClassNames]).toEqual(['!w-3 !h-3 !bg-primary !border-2 !border-background'])
  })
})
