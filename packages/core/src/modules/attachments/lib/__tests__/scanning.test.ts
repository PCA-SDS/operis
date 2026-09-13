/**
 * The malware-scan gate.
 *
 * These pin the two decisions that carry the risk: that only a cleared file is
 * readable, and that a caller who was never entitled to the file learns nothing
 * about it — including whether it is still being scanned.
 */
import { checkAttachmentAccess } from '../access'
import { interpretClamAvResponse, MisconfiguredScanner, resolveAttachmentScanner, UnscannedAttachmentScanner } from '../scanning'
import type { Attachment, AttachmentPartition, AttachmentScanStatus } from '../../data/entities'

type Auth = Parameters<typeof checkAttachmentAccess>[0]

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'

function attachment(scanStatus: AttachmentScanStatus): Attachment {
  return { id: 'a1', tenantId: TENANT, organizationId: ORG, scanStatus } as Attachment
}

function partition(isPublic = false): AttachmentPartition {
  return { code: 'chat', isPublic } as AttachmentPartition
}

const insider = { tenantId: TENANT, orgId: ORG } as unknown as Auth
const outsider = { tenantId: 'other-tenant', orgId: 'other-org' } as unknown as Auth

describe('scan gate', () => {
  it('serves a file only once the scan has cleared it', () => {
    expect(checkAttachmentAccess(insider, attachment('clean'), partition())).toEqual({ ok: true })
  })

  it.each<AttachmentScanStatus>(['pending', 'infected', 'failed'])(
    'refuses a %s file to someone who is otherwise entitled to it',
    (status) => {
      // `failed` is included deliberately: a scanner that could not answer has
      // said nothing about the file, and treating silence as safety is the
      // whole failure this gate exists to prevent.
      expect(checkAttachmentAccess(insider, attachment(status), partition())).toEqual({
        ok: false,
        status: 409,
      })
    },
  )

  it('tells an outsider 403 whatever the scan says, so the file is not confirmed', () => {
    // If the scan gate ran first, "409, still scanning" would confirm to another
    // tenant that the attachment exists.
    for (const status of ['pending', 'clean', 'infected', 'failed'] as AttachmentScanStatus[]) {
      expect(checkAttachmentAccess(outsider, attachment(status), partition())).toEqual({
        ok: false,
        status: 403,
      })
    }
  })

  it('lets a metadata caller see an uncleared file when it opts in explicitly', () => {
    // The composer has to be able to say "checking" or "rejected" about the
    // upload the reader just made. This flag is for that, and never for bytes.
    expect(
      checkAttachmentAccess(insider, attachment('pending'), partition(), { allowUnscanned: true }),
    ).toEqual({ ok: true })
  })

  it('does not let the opt-out widen who may look', () => {
    expect(
      checkAttachmentAccess(outsider, attachment('pending'), partition(), { allowUnscanned: true }),
    ).toEqual({ ok: false, status: 403 })
  })
})

describe('scanner resolution', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('clears everything when no scanner is configured, and says it inspected nothing', async () => {
    delete process.env.OM_ATTACHMENT_SCANNER
    const scanner = resolveAttachmentScanner()
    expect(scanner).toBeInstanceOf(UnscannedAttachmentScanner)
    // The honest half: callers can tell nothing looked at the bytes.
    expect(scanner.inspects).toBe(false)
  })

  it('fails closed when a scanner is named but cannot run', async () => {
    // Falling back to "clears everything" here would silently undo the thing
    // the operator asked for.
    process.env.OM_ATTACHMENT_SCANNER = 'clamav'
    delete process.env.OM_ATTACHMENT_CLAMAV_HOST
    delete process.env.CLAMAV_HOST
    const scanner = resolveAttachmentScanner()
    expect(scanner).toBeInstanceOf(MisconfiguredScanner)
    await expect(scanner.scan({ fileName: 'a.pdf', mimeType: 'application/pdf', size: 1 })).resolves.toMatchObject({
      status: 'failed',
    })
  })

  it('builds a clamav scanner when host is configured', () => {
    process.env.OM_ATTACHMENT_SCANNER = 'clamav'
    process.env.OM_ATTACHMENT_CLAMAV_HOST = 'clamd'
    const scanner = resolveAttachmentScanner()
    expect(scanner.key).toBe('clamav')
    expect(scanner.inspects).toBe(true)
  })
})

describe('clamav wire responses', () => {
  it('reads a clean answer', () => {
    expect(interpretClamAvResponse('stream: OK\0')).toEqual({ status: 'clean' })
  })

  it('reads a detection and keeps the signature for the log', () => {
    expect(interpretClamAvResponse('stream: Eicar-Test-Signature FOUND\0')).toEqual({
      status: 'infected',
      signature: 'Eicar-Test-Signature',
    })
  })

  it('treats anything else as a failure rather than as clean', () => {
    expect(interpretClamAvResponse('ERROR: size limit exceeded')).toMatchObject({ status: 'failed' })
    expect(interpretClamAvResponse('')).toMatchObject({ status: 'failed' })
  })
})

describe('executable content, whatever it is called', () => {
  const { hasExecutableSignature, isActiveContentAttachment } = require('../security') as typeof import('../security')

  it.each<[string, number[]]>([
    ['Windows PE (MZ)', [0x4d, 0x5a, 0x90, 0x00]],
    ['Linux ELF', [0x7f, 0x45, 0x4c, 0x46]],
    ['Mach-O 64-bit', [0xcf, 0xfa, 0xed, 0xfe]],
    ['universal / Java class', [0xca, 0xfe, 0xba, 0xbe]],
    ['shebang script', [0x23, 0x21, 0x2f, 0x62]],
  ])('detects %s', (_label, bytes) => {
    expect(hasExecutableSignature(Buffer.from(bytes))).toBe(true)
  })

  it.each<[string, number[]]>([
    ['PDF', [0x25, 0x50, 0x44, 0x46]],
    ['PNG', [0x89, 0x50, 0x4e, 0x47]],
    ['plain text', [0x68, 0x65, 0x6c, 0x6c]],
  ])('leaves %s alone', (_label, bytes) => {
    expect(hasExecutableSignature(Buffer.from(bytes))).toBe(false)
  })

  it('refuses an executable that arrived under a harmless name', () => {
    // Extension checks stop `payload.exe`; they do nothing about the same
    // payload renamed `invoice.pdf`. This is the gap the signatures close.
    expect(
      isActiveContentAttachment(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'invoice.pdf', 'application/pdf'),
    ).toBe(true)
  })

  it('does not flag a genuine document', () => {
    expect(
      isActiveContentAttachment(Buffer.from('%PDF-1.4 hello'), 'invoice.pdf', 'application/pdf'),
    ).toBe(false)
  })

  it('is not mistaken for malware protection', () => {
    // A macro-bearing document is a scanner's problem, not a signature table's.
    // Asserting the boundary keeps someone from "improving" this into a
    // pretend antivirus.
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    expect(hasExecutableSignature(docx)).toBe(false)
  })
})
