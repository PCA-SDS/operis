import {
  canDeleteConstraint,
  hideMatchingIncomingConstraint,
  shouldApplyConstraintDelete,
} from '../ConstraintsEditor'

describe('ConstraintsEditor state transitions', () => {
  it('blocks delete for locked constraints and applies confirmed deletes only when unlocked', () => {
    expect(canDeleteConstraint(true)).toBe(false)
    expect(shouldApplyConstraintDelete(true, true)).toBe(false)
    expect(shouldApplyConstraintDelete(false, false)).toBe(false)
    expect(shouldApplyConstraintDelete(false, true)).toBe(true)
  })

  it('hides only the matching incoming view after deleting an outgoing constraint', () => {
    const hidden = new Set(['already-hidden'])
    const next = hideMatchingIncomingConstraint(hidden, 'constraint-1', ['constraint-1', 'constraint-2'])

    expect(next).toEqual(new Set(['already-hidden', 'constraint-1']))
    expect(hideMatchingIncomingConstraint(hidden, 'constraint-3', ['constraint-1'])).toBe(hidden)
  })
})
