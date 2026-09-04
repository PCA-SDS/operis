import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

/**
 * Chat's limits are keyed on `tenant:user`, not on client IP.
 *
 * The declarative `metadata.rateLimit` path keys on the client IP and falls back
 * to a single shared `'global'` bucket whenever no IP can be trusted — which is
 * the default (`RATE_LIMIT_TRUST_PROXY_DEPTH=0`) behind a reverse proxy. One
 * chatty user would then throttle the whole deployment. Keying on the
 * authenticated subject is both the correct blast radius and un-spoofable,
 * because it comes from the session.
 *
 * The numbers are set so that a fast typist in a real conversation never sees
 * them, and a script does.
 */
export const chatSendRateLimit = readEndpointRateLimitConfig('CHAT_SEND', {
  // Roughly three messages a second sustained — far above human typing, far
  // below a flood.
  points: 30,
  duration: 10,
  blockDuration: 30,
  keyPrefix: 'chat_send',
})

export const chatConversationCreateRateLimit = readEndpointRateLimitConfig('CHAT_CONVERSATION_CREATE', {
  // Starting conversations is rare; a burst of them is someone walking the
  // directory.
  points: 20,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'chat_conversation_create',
})

export const chatDirectoryRateLimit = readEndpointRateLimitConfig('CHAT_DIRECTORY', {
  // One per second sustained: comfortably above a debounced search box, and a
  // block window so a script cannot simply pace itself at the limit forever.
  points: 60,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'chat_directory',
})

/**
 * Advancing the read cursor. Generous — opening conversations quickly is normal
 * — but present, so the one remaining write in the module is not unmetered.
 */
export const chatReadCursorRateLimit = readEndpointRateLimitConfig('CHAT_READ_CURSOR', {
  points: 120,
  duration: 60,
  keyPrefix: 'chat_read_cursor',
})

/**
 * The topbar badge. Event-driven rather than polled, so a healthy client makes
 * a handful of these per session; the cap only bounds a client that misbehaves.
 */
export const chatUnreadCountRateLimit = readEndpointRateLimitConfig('CHAT_UNREAD_COUNT', {
  points: 120,
  duration: 60,
  keyPrefix: 'chat_unread_count',
})
