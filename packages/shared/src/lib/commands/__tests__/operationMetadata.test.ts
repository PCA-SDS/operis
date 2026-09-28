/** @jest-environment node */
import {
  attachOperationMetadataHeader,
  deserializeOperationMetadata,
  OPERATION_METADATA_HEADER_NAME,
  type OperationLogEntryLike,
} from '../operationMetadata'

const FALLBACK = { resourceKind: 'customers.interaction', resourceId: 'int-42' }

function makeLogEntry(overrides: Partial<OperationLogEntryLike> = {}): OperationLogEntryLike {
  return {
    id: 'log-1',
    undoToken: 'undo-abc',
    commandId: 'customers.interactions.complete',
    actionLabel: 'Complete interaction',
    resourceKind: 'customers.interaction',
    resourceId: 'int-1',
    createdAt: new Date('2026-04-23T20:00:00Z'),
    ...overrides,
  }
}

function readHeader(response: Response) {
  return deserializeOperationMetadata(response.headers.get(OPERATION_METADATA_HEADER_NAME))
}

describe('attachOperationMetadataHeader', () => {
  it('attaches a deserializable header for an undoable entry and returns the same response', () => {
    const response = new Response(null)
    const returned = attachOperationMetadataHeader(response, makeLogEntry(), FALLBACK)

    expect(returned).toBe(response)
    expect(readHeader(response)).toEqual({
      id: 'log-1',
      undoToken: 'undo-abc',
      commandId: 'customers.interactions.complete',
      actionLabel: 'Complete interaction',
      resourceKind: 'customers.interaction',
      resourceId: 'int-1',
      executedAt: '2026-04-23T20:00:00.000Z',
    })
  })

  it('falls back to the provided resource when the entry omits it', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry({ resourceKind: null, resourceId: null, actionLabel: null }), FALLBACK)

    const parsed = readHeader(response)
    expect(parsed?.resourceKind).toBe('customers.interaction')
    expect(parsed?.resourceId).toBe('int-42')
    expect(parsed?.actionLabel).toBeNull()
  })

  it('reports null resources when neither the entry nor a fallback has them', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry({ resourceKind: undefined, resourceId: undefined }))

    const parsed = readHeader(response)
    expect(parsed?.resourceKind).toBeNull()
    expect(parsed?.resourceId).toBeNull()
  })

  it('keeps a string creation time and uses the current time when there is none', () => {
    const withString = new Response(null)
    attachOperationMetadataHeader(withString, makeLogEntry({ createdAt: '2026-01-02T03:04:05.000Z' }))
    expect(readHeader(withString)?.executedAt).toBe('2026-01-02T03:04:05.000Z')

    const before = Date.now()
    const withoutTime = new Response(null)
    attachOperationMetadataHeader(withoutTime, makeLogEntry({ createdAt: null }))
    const executedAt = Date.parse(readHeader(withoutTime)?.executedAt ?? '')
    expect(executedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(executedAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it.each([
    ['the entry is null', null],
    ['the entry is undefined', undefined],
    ['the undo token is missing', makeLogEntry({ undoToken: null })],
    ['the id is missing', makeLogEntry({ id: null })],
    ['the command id is missing', makeLogEntry({ commandId: null })],
  ])('is a no-op when %s', (_label, entry) => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, entry, FALLBACK)
    expect(response.headers.get(OPERATION_METADATA_HEADER_NAME)).toBeNull()
  })

  it('leaves immutable headers untouched instead of throwing', () => {
    const response = Response.redirect('https://example.test/next', 302)
    expect(() => attachOperationMetadataHeader(response, makeLogEntry())).not.toThrow()
    expect(response.headers.get(OPERATION_METADATA_HEADER_NAME)).toBeNull()
  })
})
