/**
 * The chart's tree builder. Every case here is a shape the database can
 * genuinely hold — roles are edited independently, so a parent can vanish and
 * a cycle can be introduced without anything stopping it.
 */
import { buildOrgForest, type OrgChartNode } from '../lib/orgChart'

type OrgRole = { id: string; name: string; parentRoleId: string | null }
type RoleNode = OrgChartNode<OrgRole>

const role = (id: string, parentRoleId: string | null = null): OrgRole => ({ id, name: id, parentRoleId })

function idsOf(nodes: RoleNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...idsOf(node.children)])
}

describe('org chart forest', () => {
  it('nests a child under its parent', () => {
    const forest = buildOrgForest([role('ceo'), role('cto', 'ceo')])
    expect(forest).toHaveLength(1)
    expect(forest[0].id).toBe('ceo')
    expect(forest[0].children.map((n) => n.id)).toEqual(['cto'])
  })

  it('treats a role whose parent is missing as a root, rather than dropping it', () => {
    // The parent may have been deleted, or belong to another tenant. Losing the
    // child would quietly remove people from the chart.
    const forest = buildOrgForest([role('orphan', 'gone')])
    expect(idsOf(forest)).toEqual(['orphan'])
  })

  it('keeps every role when two of them point at each other', () => {
    // A cycle is reachable by editing two roles in turn; the builder must still
    // terminate and still account for both.
    const forest = buildOrgForest([role('a', 'b'), role('b', 'a')])
    expect(idsOf(forest).sort()).toEqual(['a', 'b'])
  })

  it('treats a role that is its own parent as a root', () => {
    const forest = buildOrgForest([role('self', 'self')])
    expect(idsOf(forest)).toEqual(['self'])
  })

  it('places every role exactly once in a deep chain', () => {
    const forest = buildOrgForest([role('d', 'c'), role('c', 'b'), role('b', 'a'), role('a')])
    expect(idsOf(forest)).toEqual(['a', 'b', 'c', 'd'])
  })
})
