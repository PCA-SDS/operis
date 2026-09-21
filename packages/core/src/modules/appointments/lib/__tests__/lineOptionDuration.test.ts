import { resolveDurationMinutes } from '../lineOptionSnapshot'

const ADDON_30 = { durationValue: 30, durationUnit: 'minute', isAddon: true }
const OVERRIDE_90 = { durationValue: 90, durationUnit: 'minute', isAddon: false }

/**
 * `AppointmentLine.durationMinutes` is persisted already resolved — `snapshotLineOptions`
 * writes `resolveDurationMinutes(base, selectedOptions)` back onto the line at intake.
 * Every read path must therefore use that value as-is. Re-resolving it against the same
 * snapshot rows double-counts add-ons, which is what laid a 90-minute booking out as a
 * 120-minute block on the seat planner grid.
 */
describe('resolveDurationMinutes re-application', () => {
  it('is NOT idempotent for add-ons, so a resolved value must never be resolved again', () => {
    const resolvedAtIntake = resolveDurationMinutes(60, [ADDON_30])
    expect(resolvedAtIntake).toBe(90)

    expect(resolveDurationMinutes(resolvedAtIntake, [ADDON_30])).toBe(120)
  })

  it('is idempotent for overrides, which is why the defect only surfaced on add-ons', () => {
    const resolvedAtIntake = resolveDurationMinutes(60, [OVERRIDE_90])
    expect(resolvedAtIntake).toBe(90)

    expect(resolveDurationMinutes(resolvedAtIntake, [OVERRIDE_90])).toBe(90)
  })

  it('sums several add-ons on top of the base exactly once', () => {
    expect(resolveDurationMinutes(60, [
      ADDON_30,
      { durationValue: 15, durationUnit: 'minute', isAddon: true },
    ])).toBe(105)
  })

  it('converts hour units before summing', () => {
    expect(resolveDurationMinutes(60, [{ durationValue: 1, durationUnit: 'hour', isAddon: true }])).toBe(120)
  })

  it('returns the base untouched when no option carries a duration', () => {
    expect(resolveDurationMinutes(60, [{ durationValue: null, durationUnit: null, isAddon: true }])).toBe(60)
    expect(resolveDurationMinutes(60, [])).toBe(60)
  })
})
