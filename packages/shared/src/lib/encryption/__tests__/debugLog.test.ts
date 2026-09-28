import type { Logger } from '../../logger'
import { createEncryptionDebugLog } from '../debugLog'

describe('createEncryptionDebugLog', () => {
  const original = process.env.TENANT_DATA_ENCRYPTION_DEBUG
  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_DATA_ENCRYPTION_DEBUG
    else process.env.TENANT_DATA_ENCRYPTION_DEBUG = original
  })

  function loggerWith(debug: jest.Mock): Logger {
    return { debug } as unknown as Logger
  }

  it('writes only while the debug toggle is on, reading it on every call', () => {
    const debug = jest.fn()
    const log = createEncryptionDebugLog(loggerWith(debug))
    delete process.env.TENANT_DATA_ENCRYPTION_DEBUG
    log('encrypt', { length: 1 })
    expect(debug).not.toHaveBeenCalled()
    process.env.TENANT_DATA_ENCRYPTION_DEBUG = 'true'
    log('encrypt', { length: 2 })
    expect(debug).toHaveBeenCalledWith('encrypt', { length: 2 })
  })

  it('never lets a logging failure escape', () => {
    process.env.TENANT_DATA_ENCRYPTION_DEBUG = 'true'
    const log = createEncryptionDebugLog(loggerWith(jest.fn(() => { throw new Error('sink down') })))
    expect(() => log('decrypt', {})).not.toThrow()
  })
})
