import {
  DEFAULT_SCHEDULER_POLL_INTERVAL_MS,
  getSchedulerPollIntervalMs,
} from '../pollInterval'

const ENV_KEY = 'SCHEDULER_POLL_INTERVAL_MS'
const original = process.env[ENV_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
})

describe('getSchedulerPollIntervalMs', () => {
  it('defaults when unset', () => {
    delete process.env[ENV_KEY]
    expect(getSchedulerPollIntervalMs()).toBe(DEFAULT_SCHEDULER_POLL_INTERVAL_MS)
  })

  // NaN would reach setTimeout and the `Math.round(pollInterval / 1000)` the CLI
  // prints, so an unusable value must resolve to the default instead.
  it.each(['abc', ' ', '0', '-1'])('falls back when the value is unusable: %p', (raw) => {
    process.env[ENV_KEY] = raw
    const interval = getSchedulerPollIntervalMs()
    expect(Number.isFinite(interval)).toBe(true)
    expect(interval).toBe(DEFAULT_SCHEDULER_POLL_INTERVAL_MS)
  })

  it('honours a valid override', () => {
    process.env[ENV_KEY] = '5000'
    expect(getSchedulerPollIntervalMs()).toBe(5000)
  })
})
