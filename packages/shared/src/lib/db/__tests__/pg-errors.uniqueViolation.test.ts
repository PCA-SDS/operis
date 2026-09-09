/** @jest-environment node */

import { isUniqueViolation } from '../pg-errors'

/**
 * Each case is a wrapper shape one of the twelve hand-rolled copies used to be
 * the only detector for. The consolidated version must recognise all of them.
 */
describe('isUniqueViolation covers every wrapper shape it replaced', () => {
  it('top-level SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('sqlState spelling', () => {
    expect(isUniqueViolation({ sqlState: '23505' })).toBe(true)
  })

  it('nested under cause', () => {
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true)
  })

  it("nested under MikroORM's previous", () => {
    expect(isUniqueViolation({ previous: { code: '23505' } })).toBe(true)
  })

  it('nested under driverError', () => {
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true)
  })

  it('nested two wrappers deep', () => {
    expect(isUniqueViolation({ cause: { driverError: { sqlState: '23505' } } })).toBe(true)
  })

  it('the ORM exception by name', () => {
    expect(isUniqueViolation({ name: 'UniqueConstraintViolationException' })).toBe(true)
  })

  it('does NOT match on message alone by default', () => {
    // A "don't leak internal errors" path relies on this: an unrelated failure
    // that merely quotes a constraint must stay a 500, not become a 409.
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' })).toBe(false)
  })

  it('matches on message when the caller opts in', () => {
    expect(
      isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' }, undefined, { matchMessage: true }),
    ).toBe(true)
  })

  it('narrows to a named constraint when asked', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'uq_a' }, 'uq_a')).toBe(true)
    expect(isUniqueViolation({ code: '23505', constraint: 'uq_b' }, 'uq_a')).toBe(false)
  })

  it('finds the constraint in detail or message too', () => {
    expect(isUniqueViolation({ code: '23505', detail: 'Key (x)=(1) already exists in uq_a' }, 'uq_a')).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })

  it('survives a cyclic error chain', () => {
    const a: Record<string, unknown> = { code: '42P01' }
    a.cause = a
    expect(isUniqueViolation(a)).toBe(false)
  })
})
