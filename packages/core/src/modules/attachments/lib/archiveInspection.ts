import { getAttachmentExtension, hasDangerousExecutableExtension } from './security'

/**
 * Looking inside an archive before accepting it.
 *
 * An upload policy that blocks `.exe` and accepts `.zip` blocks nothing: the
 * executable simply travels one layer down. So an archive is inspected against
 * the same rules its contents would have faced on their own.
 *
 * The inspection reads the **central directory** and never decompresses
 * anything. That is the whole design: entry names, declared sizes and the
 * encryption flag are all recorded there in plain form, so the checks that
 * protect against a zip bomb do not themselves have to expand one. Nothing here
 * allocates memory proportional to what the archive claims to contain.
 */

/** Signatures, little-endian, as they appear on disk. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
/** The EOCD is at the end, after a comment of at most 65535 bytes. */
const MAX_EOCD_SEARCH = 66_000
/** General purpose bit 0: the entry is encrypted. */
const ENCRYPTED_FLAG = 0x0001

/**
 * Ceilings. Each exists because the alternative is an archive that costs more
 * to handle than it took to send.
 */
export const ARCHIVE_LIMITS = {
  /** Beyond this an archive is a filesystem, not an attachment. */
  maxEntries: 2_000,
  /** Total declared uncompressed bytes. */
  maxUncompressedBytes: 2 * 1024 * 1024 * 1024,
  /**
   * Uncompressed-to-compressed ratio at which an archive stops being
   * compression and starts being a weapon. Ordinary documents sit well under
   * 100:1; a zip bomb is thousands to one.
   */
  maxCompressionRatio: 200,
  /** Nested archives, one layer of which is already a way to hide things. */
  allowNestedArchives: false,
} as const

const ARCHIVE_EXTENSIONS = new Set(['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar'])

export type ArchiveRejection =
  | { reason: 'encrypted' }
  | { reason: 'dangerous_entry'; entry: string }
  | { reason: 'path_traversal'; entry: string }
  | { reason: 'nested_archive'; entry: string }
  | { reason: 'too_many_entries' }
  | { reason: 'too_large_uncompressed' }
  | { reason: 'compression_ratio' }
  | { reason: 'unreadable' }

export type ArchiveInspection = { ok: true; entries: number } | { ok: false } & ArchiveRejection

/** Whether this file is an archive worth looking inside. */
export function isArchiveFileName(fileName: string | null | undefined): boolean {
  return ARCHIVE_EXTENSIONS.has(getAttachmentExtension(fileName))
}

/**
 * Whether an entry path tries to escape the directory it is extracted into.
 *
 * Checked on the archive's own bytes rather than at extraction time, because
 * whoever extracts it may not be us — a file that would write to `/etc` on
 * somebody's laptop should not be sitting in a conversation waiting for them.
 */
function escapesRoot(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return true
  // A Windows drive letter is absolute too.
  if (/^[a-zA-Z]:/.test(normalized)) return true
  return normalized.split('/').includes('..')
}

/**
 * Inspect a ZIP archive.
 *
 * Returns a rejection rather than throwing: an archive we cannot read is a
 * decision, not an error — and the decision is to refuse it (§14). An opaque
 * file is not made safe by being unreadable.
 */
export function inspectZipArchive(buffer: Buffer): ArchiveInspection {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd === null) return { ok: false, reason: 'unreadable' }

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount > ARCHIVE_LIMITS.maxEntries) return { ok: false, reason: 'too_many_entries' }
  if (directoryOffset >= buffer.length) return { ok: false, reason: 'unreadable' }

  let cursor = directoryOffset
  let totalUncompressed = 0
  let totalCompressed = 0
  let seen = 0

  while (seen < entryCount) {
    // A truncated or lying directory is unreadable, not empty.
    if (cursor + 46 > buffer.length) return { ok: false, reason: 'unreadable' }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      return { ok: false, reason: 'unreadable' }
    }

    const flags = buffer.readUInt16LE(cursor + 8)
    // Refused rather than accepted-and-hoped: the contents cannot be checked,
    // and an archive nothing can look inside is exactly the shape used to carry
    // something that would not have been accepted on its own.
    if ((flags & ENCRYPTED_FLAG) !== 0) return { ok: false, reason: 'encrypted' }

    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)

    const nameStart = cursor + 46
    if (nameStart + nameLength > buffer.length) return { ok: false, reason: 'unreadable' }
    const entryName = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')

    if (escapesRoot(entryName)) return { ok: false, reason: 'path_traversal', entry: entryName }

    // Directories are entries too, and they carry no payload to judge.
    const isDirectory = entryName.endsWith('/')
    if (!isDirectory) {
      if (hasDangerousExecutableExtension(entryName)) {
        return { ok: false, reason: 'dangerous_entry', entry: entryName }
      }
      if (!ARCHIVE_LIMITS.allowNestedArchives && isArchiveFileName(entryName)) {
        // One layer can be inspected; a layer inside it is another inspection
        // to write and another set of limits to get right. Refusing is the
        // honest position while only one layer is checked.
        return { ok: false, reason: 'nested_archive', entry: entryName }
      }
    }

    totalUncompressed += uncompressedSize
    totalCompressed += compressedSize
    if (totalUncompressed > ARCHIVE_LIMITS.maxUncompressedBytes) {
      return { ok: false, reason: 'too_large_uncompressed' }
    }

    cursor = nameStart + nameLength + extraLength + commentLength
    seen += 1
  }

  // Ratio last, on the totals: a single small entry can look extreme without
  // meaning anything, while the whole archive's ratio is the real signal.
  if (
    totalCompressed > 0 &&
    totalUncompressed / totalCompressed > ARCHIVE_LIMITS.maxCompressionRatio
  ) {
    return { ok: false, reason: 'compression_ratio' }
  }

  return { ok: true, entries: seen }
}

/** Scan backwards for the end-of-central-directory record. */
function findEndOfCentralDirectory(buffer: Buffer): number | null {
  const from = Math.max(0, buffer.length - MAX_EOCD_SEARCH)
  for (let at = buffer.length - 22; at >= from; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at
  }
  return null
}

/**
 * Inspect an archive by name, when its format is one we can read.
 *
 * Only ZIP is inspectable here. The others are refused rather than accepted
 * unread — accepting an opaque `.tar.gz` because we happen not to have a reader
 * for it is the exact bypass the ZIP inspection exists to close.
 */
export function inspectArchive(fileName: string, buffer: Buffer): ArchiveInspection {
  const extension = getAttachmentExtension(fileName)
  if (extension === 'zip') return inspectZipArchive(buffer)
  if (ARCHIVE_EXTENSIONS.has(extension)) return { ok: false, reason: 'unreadable' }
  return { ok: true, entries: 0 }
}
