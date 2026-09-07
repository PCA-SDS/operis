export type StoreFilePayload = {
  partitionCode: string
  orgId: string | null | undefined
  tenantId: string | null | undefined
  fileName: string
  buffer: Buffer
  storagePath?: string
}

export type PrepareFilePayload = Omit<StoreFilePayload, 'buffer' | 'storagePath'>

export type StoredFile = {
  storagePath: string
  driverMeta?: Record<string, unknown> | null
}

export type ReadFileResult = {
  buffer: Buffer
  contentType?: string
}

/**
 * A URL the client may upload to directly, and what it must send with it.
 *
 * The URL is bound to one key, one content type and one length, so it cannot be
 * reused to write something else somewhere else. Short-lived by design: it is a
 * capability, and a capability that outlives the action it was granted for is a
 * credential nobody is tracking.
 */
export type DirectUploadTicket = {
  url: string
  method: 'PUT'
  /** Headers the client must send verbatim; the signature covers them. */
  headers: Record<string, string>
  storagePath: string
  expiresAt: string
}

export type CreateDirectUploadPayload = PrepareFilePayload & {
  contentType: string
  contentLength: number
  expiresInSeconds?: number
}

/** What a stored object turned out to be, read from storage rather than claimed. */
export type StoredObjectFacts = {
  size: number
  contentType?: string | null
}

export interface StorageDriver {
  readonly key: string
  prepareStoragePath?(payload: PrepareFilePayload): string
  store(payload: StoreFilePayload): Promise<StoredFile>
  read(partitionCode: string, storagePath: string): Promise<ReadFileResult>
  delete(partitionCode: string, storagePath: string): Promise<void>
  deleteStrict?(partitionCode: string, storagePath: string): Promise<void>
  toLocalPath(
    partitionCode: string,
    storagePath: string,
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }>

  /**
   * Hand the client a URL it can upload to without the bytes passing through
   * the app.
   *
   * Optional because it is a property of the backing store, not of the
   * interface: a local-disk driver has nowhere to point such a URL. A caller
   * that finds this absent should fall back to uploading through its own
   * endpoint rather than failing — which is what keeps development, where the
   * local driver is the default, working exactly as production does.
   */
  createDirectUpload?(payload: CreateDirectUploadPayload): Promise<DirectUploadTicket>

  /**
   * What is actually at this key, if anything.
   *
   * The point of finalisation: after a direct upload the server has seen none
   * of the bytes, so the size and type it records must come from the store and
   * not from whatever the client said it sent.
   */
  stat?(partitionCode: string, storagePath: string): Promise<StoredObjectFacts | null>
}
