import { hasAllFeatures as hasAllFeaturesRequiredFirst, matchFeature } from '../featureMatch'
import { hasAllFeatures as hasAllFeaturesGrantedFirst } from '../../../security/features'

/**
 * `hasAllFeatures` is exported from two paths with OPPOSITE argument orders:
 *
 *   lib/auth/featureMatch  -> (required, granted)
 *   security/features      -> (granted, required)
 *
 * Both parameters are string arrays, so a swapped call is invisible to TypeScript
 * and silently changes the authorization answer — the second argument is the one
 * treated as the wildcard *pattern* set. They were previously two independent
 * implementations; `security/features` now delegates to the primitive so there is a
 * single algorithm.
 *
 * These tests pin both conventions and prove the swap is observable, so the two can
 * never drift apart again and nobody can "simplify" one into the other's order.
 */

const GRANTED = ['orders.*', 'catalog.read']

describe('hasAllFeatures — the two argument conventions', () => {
  it('featureMatch takes (required, granted)', () => {
    expect(hasAllFeaturesRequiredFirst(['orders.read'], GRANTED)).toBe(true)
    expect(hasAllFeaturesRequiredFirst(['billing.read'], GRANTED)).toBe(false)
  })

  it('security/features takes (granted, required)', () => {
    expect(hasAllFeaturesGrantedFirst(GRANTED, ['orders.read'])).toBe(true)
    expect(hasAllFeaturesGrantedFirst(GRANTED, ['billing.read'])).toBe(false)
  })

  it('the two agree when each is called with its own convention', () => {
    const cases: Array<{ required: string[]; granted: string[] }> = [
      { required: ['orders.read'], granted: ['orders.*'] },
      { required: ['orders.read'], granted: ['*'] },
      { required: ['orders.read', 'catalog.read'], granted: ['orders.*', 'catalog.read'] },
      { required: ['orders.read'], granted: ['catalog.read'] },
      { required: [], granted: [] },
      { required: ['a.b'], granted: [] },
    ]
    for (const { required, granted } of cases) {
      expect(hasAllFeaturesRequiredFirst(required, granted)).toBe(
        hasAllFeaturesGrantedFirst(granted, required),
      )
    }
  })

  it('a swapped call really does change the answer (why the order matters)', () => {
    // Correct: a concrete requirement satisfied by a wildcard grant -> allowed.
    expect(hasAllFeaturesRequiredFirst(['orders.read'], ['orders.*'])).toBe(true)
    // Swapped: the requirement list is now treated as the grant/pattern list. The
    // literal grant 'orders.read' does not match the pattern-position 'orders.*',
    // so the answer flips. This asymmetry is exactly the footgun being guarded.
    expect(hasAllFeaturesRequiredFirst(['orders.*'], ['orders.read'])).toBe(false)
  })

  it('empty required allows, empty granted denies (fail-closed)', () => {
    expect(hasAllFeaturesRequiredFirst([], ['anything'])).toBe(true)
    expect(hasAllFeaturesRequiredFirst(['orders.read'], [])).toBe(false)
    expect(hasAllFeaturesGrantedFirst([], ['orders.read'])).toBe(false)
    expect(hasAllFeaturesGrantedFirst(undefined, ['orders.read'])).toBe(false)
    expect(hasAllFeaturesGrantedFirst(['orders.*'], undefined)).toBe(true)
  })

  it('wildcard semantics are unchanged by the delegation', () => {
    expect(matchFeature('orders.read', '*')).toBe(true)
    expect(matchFeature('orders', 'orders.*')).toBe(true)
    expect(matchFeature('orders.read', 'orders.*')).toBe(true)
    expect(matchFeature('ordersX.read', 'orders.*')).toBe(false)
    expect(matchFeature('orders.read', 'orders.read')).toBe(true)
  })
})
