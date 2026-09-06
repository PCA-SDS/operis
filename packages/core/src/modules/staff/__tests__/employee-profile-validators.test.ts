import {
  staffEmployeeProfileCreateSchema,
  staffEmployeeProfileUpdateSchema,
} from '../data/validators'

const BASE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  memberId: '33333333-3333-4333-8333-333333333333',
}

describe('staff employee profile validators', () => {
  it('accepts a record with no employment dates at all', () => {
    // Every HR field is optional: a member can be in the directory before
    // anyone has filled in their paperwork.
    expect(staffEmployeeProfileCreateSchema.safeParse(BASE).success).toBe(true)
  })

  it('rejects an end date before the start date', () => {
    const result = staffEmployeeProfileCreateSchema.safeParse({
      ...BASE,
      startDate: '2026-03-01',
      endDate: '2026-02-01',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endDate'])
    }
  })

  it('allows an end date equal to the start date', () => {
    // A single-day contract is a real thing, so the check is not strict.
    expect(
      staffEmployeeProfileCreateSchema.safeParse({ ...BASE, startDate: '2026-03-01', endDate: '2026-03-01' }).success,
    ).toBe(true)
  })

  it('leaves the date check satisfied when only one end is given', () => {
    expect(staffEmployeeProfileCreateSchema.safeParse({ ...BASE, startDate: '2026-03-01' }).success).toBe(true)
    expect(staffEmployeeProfileCreateSchema.safeParse({ ...BASE, endDate: '2026-03-01' }).success).toBe(true)
  })

  it('rejects a malformed personal email but allows it to be cleared', () => {
    expect(staffEmployeeProfileCreateSchema.safeParse({ ...BASE, personalEmail: 'nope' }).success).toBe(false)
    expect(staffEmployeeProfileCreateSchema.safeParse({ ...BASE, personalEmail: null }).success).toBe(true)
  })

  it('rejects a date that is not a calendar day', () => {
    expect(staffEmployeeProfileCreateSchema.safeParse({ ...BASE, dateOfBirth: '01/02/1990' }).success).toBe(false)
  })

  it('lets an update omit the member, which cannot be reassigned', () => {
    const result = staffEmployeeProfileUpdateSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      jobTitle: 'Engineer',
    })
    expect(result.success).toBe(true)
  })
})
