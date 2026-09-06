/**
 * Looking inside an archive.
 *
 * The rule this enforces: an archive is judged by what its contents would have
 * faced on their own. A policy that blocks `.exe` and accepts `.zip` blocks
 * nothing, and every case here is a way to carry something past it.
 *
 * Archives are built by hand rather than with a library, because the thing
 * under test is how we read the bytes — a builder that shares our assumptions
 * would agree with us about a file no real zip tool would produce.
 */
import { inspectArchive, inspectZipArchive, isArchiveFileName } from '../archiveInspection'

type Entry = {
  name: string
  compressed?: number
  uncompressed?: number
  encrypted?: boolean
}

/** A ZIP with only a central directory — enough for an inspection to read. */
function buildZip(entries: Entry[], options: { entryCountOverride?: number } = {}): Buffer {
  const records = entries.map((entry) => {
    const name = Buffer.from(entry.name, 'utf8')
    const record = Buffer.alloc(46 + name.length)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(entry.encrypted ? 0x0001 : 0, 8)
    record.writeUInt32LE(entry.compressed ?? 100, 20)
    record.writeUInt32LE(entry.uncompressed ?? 100, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt16LE(0, 30)
    record.writeUInt16LE(0, 32)
    name.copy(record, 46)
    return record
  })

  const directory = Buffer.concat(records)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(options.entryCountOverride ?? entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(0, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([directory, eocd])
}

describe('recognising archives', () => {
  it.each(['a.zip', 'b.tar', 'c.tgz', 'd.7z', 'e.rar', 'f.gz'])('treats %s as an archive', (name) => {
    expect(isArchiveFileName(name)).toBe(true)
  })

  it.each(['report.pdf', 'photo.png', 'notes.txt'])('leaves %s alone', (name) => {
    expect(isArchiveFileName(name)).toBe(false)
  })
})

describe('inspecting a zip', () => {
  it('accepts an archive of ordinary files', () => {
    expect(inspectZipArchive(buildZip([{ name: 'docs/report.pdf' }, { name: 'docs/' }]))).toEqual({
      ok: true,
      entries: 2,
    })
  })

  it('refuses an executable hidden inside', () => {
    // The whole reason this exists.
    expect(inspectZipArchive(buildZip([{ name: 'invoice.pdf' }, { name: 'setup.exe' }]))).toMatchObject({
      ok: false,
      reason: 'dangerous_entry',
      entry: 'setup.exe',
    })
  })

  it('refuses an executable however deeply it is buried', () => {
    expect(
      inspectZipArchive(buildZip([{ name: 'a/b/c/d/payload.bat' }])),
    ).toMatchObject({ ok: false, reason: 'dangerous_entry' })
  })

  it('refuses an entry that would escape the extraction directory', () => {
    // Checked on the bytes, not at extraction: whoever extracts it may not be
    // us, and a file that would write outside its folder should not be sitting
    // in a conversation waiting for them.
    expect(inspectZipArchive(buildZip([{ name: '../../etc/passwd' }]))).toMatchObject({
      ok: false,
      reason: 'path_traversal',
    })
    expect(inspectZipArchive(buildZip([{ name: '/etc/passwd' }]))).toMatchObject({
      ok: false,
      reason: 'path_traversal',
    })
    expect(inspectZipArchive(buildZip([{ name: 'C:\\\\Windows\\\\system32\\\\a.dll' }]))).toMatchObject({
      ok: false,
      reason: 'path_traversal',
    })
  })

  it('refuses an encrypted archive rather than accepting it unread', () => {
    // An opaque file is not made safe by being unreadable.
    expect(inspectZipArchive(buildZip([{ name: 'secret.pdf', encrypted: true }]))).toMatchObject({
      ok: false,
      reason: 'encrypted',
    })
  })

  it('refuses an archive that expands out of all proportion', () => {
    expect(
      inspectZipArchive(buildZip([{ name: 'bomb.txt', compressed: 100, uncompressed: 100_000 }])),
    ).toMatchObject({ ok: false, reason: 'compression_ratio' })
  })

  it('allows ordinary compression', () => {
    // Real documents compress well; the limit must not punish them.
    expect(
      inspectZipArchive(buildZip([{ name: 'report.txt', compressed: 1000, uncompressed: 10_000 }])),
    ).toMatchObject({ ok: true })
  })

  it('refuses an archive with an implausible number of entries', () => {
    const many = Array.from({ length: 2_001 }, (_, index) => ({ name: `f${index}.txt` }))
    expect(inspectZipArchive(buildZip(many))).toMatchObject({ ok: false, reason: 'too_many_entries' })
  })

  it('refuses a nested archive, since only one layer is inspected', () => {
    expect(inspectZipArchive(buildZip([{ name: 'inner.zip' }]))).toMatchObject({
      ok: false,
      reason: 'nested_archive',
    })
  })

  it('refuses bytes it cannot read as a zip at all', () => {
    expect(inspectZipArchive(Buffer.from('not a zip'))).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(inspectZipArchive(Buffer.alloc(0))).toMatchObject({ ok: false, reason: 'unreadable' })
  })

  it('refuses a directory that lies about how many entries it holds', () => {
    // A truncated or dishonest directory is unreadable, not empty — reading it
    // as empty would accept the archive without having seen anything.
    expect(
      inspectZipArchive(buildZip([{ name: 'a.txt' }], { entryCountOverride: 5 })),
    ).toMatchObject({ ok: false, reason: 'unreadable' })
  })
})

describe('formats we cannot read', () => {
  it('refuses them rather than accepting them unread', () => {
    // Accepting an opaque `.tar.gz` because we lack a reader is the exact
    // bypass the zip inspection closes.
    for (const name of ['payload.tar', 'payload.gz', 'payload.7z', 'payload.rar']) {
      expect(inspectArchive(name, Buffer.from('anything'))).toMatchObject({
        ok: false,
        reason: 'unreadable',
      })
    }
  })

  it('leaves a non-archive alone', () => {
    expect(inspectArchive('report.pdf', Buffer.from('%PDF-1.4'))).toEqual({ ok: true, entries: 0 })
  })
})
