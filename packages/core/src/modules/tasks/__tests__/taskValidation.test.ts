import { assertNoDocCycle, assertNoSubtaskCycle } from '../lib/taskValidation'
import type { TasksMessages } from '../lib/messages'

const messages = {
  parentIsSelf: 'self',
  parentIsDescendant: 'descendant',
  docIsDescendant: 'doc-descendant',
} as unknown as TasksMessages

const SCOPE = { tenantId: 'tenant', organizationId: 'org' }

/** A stand-in EntityManager that answers the one `find` the guard makes. */
function emWith(rows: { id: string; parentTaskId: string | null }[]) {
  return { find: async () => rows } as never
}

describe('assertNoSubtaskCycle', () => {
  //   a
  //   └── b
  //       └── c
  const tree = [
    { id: 'a', parentTaskId: null },
    { id: 'b', parentTaskId: 'a' },
    { id: 'c', parentTaskId: 'b' },
  ]

  it('allows an unrelated parent', async () => {
    await expect(
      assertNoSubtaskCycle(emWith(tree), SCOPE, 'project', 'a', 'c', messages),
    ).rejects.toThrow()
    // …but moving a leaf under an unrelated node is fine.
    const flat = [
      { id: 'a', parentTaskId: null },
      { id: 'z', parentTaskId: null },
    ]
    await expect(
      assertNoSubtaskCycle(emWith(flat), SCOPE, 'project', 'z', 'a', messages),
    ).resolves.toBeUndefined()
  })

  it('rejects making a task its own parent', async () => {
    await expect(
      assertNoSubtaskCycle(emWith(tree), SCOPE, 'project', 'a', 'a', messages),
    ).rejects.toThrow()
  })

  it('rejects moving a task under its direct child', async () => {
    await expect(
      assertNoSubtaskCycle(emWith(tree), SCOPE, 'project', 'a', 'b', messages),
    ).rejects.toThrow()
  })

  it('rejects moving a task under a deep descendant', async () => {
    await expect(
      assertNoSubtaskCycle(emWith(tree), SCOPE, 'project', 'a', 'c', messages),
    ).rejects.toThrow()
  })

  it('terminates on data that is already cyclic', async () => {
    // Should the database ever hold a loop, the guard must still return rather
    // than spin — the walk is bounded by the row count.
    const looped = [
      { id: 'a', parentTaskId: 'b' },
      { id: 'b', parentTaskId: 'a' },
    ]
    await expect(
      assertNoSubtaskCycle(emWith(looped), SCOPE, 'project', 'c', 'a', messages),
    ).resolves.toBeUndefined()
  })
})

describe('assertNoDocCycle', () => {
  const parents = new Map<string, string | null>([
    ['a', null],
    ['b', 'a'],
    ['c', 'b'],
  ])

  it('rejects a page as its own parent', async () => {
    await expect(assertNoDocCycle(parents, 'a', 'a', messages)).rejects.toThrow()
  })

  it('rejects moving a page under its own sub-page', async () => {
    await expect(assertNoDocCycle(parents, 'a', 'c', messages)).rejects.toThrow()
  })

  it('allows an unrelated parent', async () => {
    await expect(assertNoDocCycle(parents, 'c', 'a', messages)).resolves.toBeUndefined()
  })
})
