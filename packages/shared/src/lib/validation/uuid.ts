/**
 * The three UUID rules in use across the repo, named once so no module carries
 * its own literal. They are deliberately not collapsed into one: which ids a
 * route accepts is part of its contract.
 */

/**
 * Any 8-4-4-4-12 hexadecimal id — what a Postgres `uuid` column accepts,
 * including ids derived with `stableUuidFromKey`, which set no version bits.
 */
export const UUID_SHAPE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An RFC 9562 UUID: versions 1–8 with the RFC variant bits. Matches `crud/ids`. */
export const RFC_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * An RFC 4122 UUID: versions 1–5 only. Older call sites still validate against
 * this narrower set (it rejects UUIDv7); prefer {@link RFC_UUID_PATTERN} for new code.
 */
export const RFC4122_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
