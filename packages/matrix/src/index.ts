/**
 * `@open-mercato/matrix` — a typed Matrix client for application services.
 *
 * Transport only. It knows nothing about chat, conversations, tenants or
 * Operis entities, so both the chat transport and any external-network channel
 * provider share one hardened client rather than growing two.
 *
 * It talks to an unmodified upstream homeserver over the Client-Server API. No
 * AGPL source is vendored here — see docs/architecture/adr/ADR-0006.
 */

export {
  MatrixError,
  MatrixConfigError,
  MatrixNamespaceError,
  classifyMatrixFailure,
  isMatrixError,
  type MatrixFailureKind,
  type MatrixErrorInit,
} from './errors'

export {
  matrixCredentialsSchema,
  resolveMatrixConfig,
  matrixConfigFromEnv,
  type MatrixConfig,
  type MatrixCredentials,
} from './config'

export {
  parseMxid,
  localpartForUser,
  mxidForUser,
  operisUserIdFromMxid,
  senderMxid,
  botMxid,
  isOwnedIdentity,
  assertMasqueradable,
  type MatrixIdentityConfig,
  type ParsedMxid,
} from './identity'

export {
  MATRIX_EVENT_TYPES,
  RELATION_TYPES,
  matrixEventSchema,
  parseMatrixEvent,
  isRoomMessage,
  isReaction,
  isRedaction,
  isMembership,
  isEncrypted,
  isRedacted,
  isReplacement,
  messageBody,
  messageMsgtype,
  replyTarget,
  annotation,
  replacement,
  membershipChange,
  ownTransactionId,
  parseMxcUri,
  type MatrixEvent,
  type MatrixContent,
  type Annotation,
  type Replacement,
  type MembershipChange,
} from './events'

export {
  deriveTransactionId,
  deriveRelatedTransactionId,
  isDerivedTransactionId,
} from './transactions'

export {
  buildRegistration,
  verifyHomeserverToken,
  extractHomeserverToken,
  parseTransaction,
  buildSyncFilter,
  type RegistrationOptions,
  type AppserviceTransaction,
} from './appservice'

export {
  MatrixClient,
  type RequestOptions,
  type SendEventResult,
  type WhoamiResult,
  type CreateRoomResult,
  type CreateRoomOptions,
  type MessagesPage,
  type RelationsPage,
  type UploadResult,
  type SyncResult,
} from './client'
