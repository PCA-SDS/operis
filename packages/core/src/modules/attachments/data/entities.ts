import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@open-mercato/shared/lib/db/decorators'
import { resolveDefaultAttachmentOcrEnabled } from '../lib/ocrConfig'

@Entity({ tableName: 'attachment_partitions' })
@Unique({ name: 'attachment_partitions_code_unique', properties: ['code'] })
export class AttachmentPartition {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'storage_driver', type: 'text', default: 'local' })
  storageDriver: string = 'local'

  @Property({ name: 'config_json', type: 'json', nullable: true })
  configJson?: Record<string, unknown> | null

  @Property({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean = false

  @Property({ name: 'requires_ocr', type: 'boolean', default: resolveDefaultAttachmentOcrEnabled() })
  requiresOcr: boolean = resolveDefaultAttachmentOcrEnabled()

  @Property({ name: 'ocr_model', type: 'text', nullable: true })
  ocrModel?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  @Index({ name: 'attachment_partitions_tenant_idx' })
  tenantId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * The scan lifecycle. `clean` is the only readable state.
 */
export type AttachmentScanStatus = 'pending' | 'clean' | 'infected' | 'failed'

@Entity({ tableName: 'attachments' })
// `quota-service.recalculate` runs `sum(file_size) where tenant_id = ?` under a
// tenant-wide advisory lock on every upload, and the table had no tenant index —
// so the aggregate was a full sequential scan and concurrent uploads in a tenant
// serialized behind it. Both columns are in the key so Postgres can answer the
// sum with an index-only scan.
@Index({ name: 'attachments_tenant_file_size_idx', properties: ['tenantId', 'fileSize'] })
export class Attachment {
  [OptionalProps]?: 'createdAt' | 'scanStatus'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'record_id', type: 'text' })
  @Index({ name: 'attachments_entity_record_idx' })
  recordId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'partition_code', type: 'text' })
  @Index({ name: 'attachments_partition_code_idx' })
  partitionCode!: string

  @Property({ name: 'file_name', type: 'text' })
  fileName!: string

  @Property({ name: 'mime_type', type: 'text' })
  mimeType!: string

  @Property({ name: 'file_size', type: 'int' })
  fileSize!: number

  @Property({ name: 'storage_driver', type: 'text', default: 'local' })
  storageDriver: string = 'local'

  @Property({ name: 'storage_path', type: 'text' })
  storagePath!: string

  @Property({ name: 'storage_metadata', type: 'jsonb', nullable: true })
  storageMetadata?: Record<string, unknown> | null

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'content', type: 'text', nullable: true })
  content: string | null = null

  /**
   * Where this file is in the malware-scan lifecycle.
   *
   * `pending` means uploaded but not yet cleared: the bytes are in storage and
   * the row exists, but nothing may serve it. `clean` is the only state that
   * reads. `infected` and `failed` both stay unreadable — a scanner that could
   * not answer is not the same as a file that is safe, and treating it as such
   * is the failure this column exists to prevent.
   *
   * Defaulted to `pending` so a new row is closed until something opens it.
   * Rows that predate the column were backfilled to `clean` by the migration:
   * they were readable before it existed, and retroactively quarantining every
   * attachment in every module is not a security improvement anyone asked for.
   */
  // The supporting index is partial (`where scan_status <> 'clean'`) and owned by
  // the migration: only the scan queue reads by status, and `clean` is nearly
  // every row. A decorator index here would be a second, full-width index
  // answering a question nobody asks.
  @Property({ name: 'scan_status', type: 'text', default: 'pending' })
  scanStatus: AttachmentScanStatus = 'pending'

  /** When the scan reached its verdict; null while pending. */
  @Property({ name: 'scanned_at', type: Date, nullable: true })
  scannedAt?: Date | null

  /**
   * Which scanner answered, for operational triage.
   *
   * Deliberately not the scanner's own message: a verdict shown to a user must
   * not describe the engine that produced it.
   */
  @Property({ name: 'scanner', type: 'text', nullable: true })
  scanner?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'attachment_quota_reservations' })
@Unique({
  name: 'attachment_quota_reservations_scope_path_unique',
  properties: ['tenantId', 'storageDriver', 'storagePath'],
})
@Index({
  name: 'attachment_quota_reservations_tenant_status_idx',
  properties: ['tenantId', 'status'],
})
export class AttachmentQuotaReservation {
  [OptionalProps]?: 'actualBytes' | 'createdAt' | 'status' | 'updatedAt' | 'uploadTokenHash'

  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'reserved_bytes', type: 'bigint' })
  reservedBytes!: number

  @Property({ name: 'actual_bytes', type: 'bigint', nullable: true })
  actualBytes?: number | null

  @Property({ type: 'text', default: 'reserved' })
  status: 'reserved' | 'storing' | 'stored' | 'recovering' | 'committed' = 'reserved'

  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'storage_driver', type: 'text' })
  storageDriver!: string

  @Property({ name: 'partition_code', type: 'text', nullable: true })
  partitionCode?: string | null

  @Property({ name: 'storage_path', type: 'text' })
  storagePath!: string

  @Property({ name: 'lease_token', type: 'uuid' })
  leaseToken!: string

  @Property({ name: 'upload_token_hash', type: 'text', nullable: true })
  uploadTokenHash?: string | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  @Index({ name: 'attachment_quota_reservations_expires_idx' })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
