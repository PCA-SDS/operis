import {
  readVersionedPreference,
  writeVersionedPreference,
  clearVersionedPreference,
} from '@open-mercato/shared/lib/browser/versionedPreference'
import { isStringArray } from '@open-mercato/shared/lib/guards'

const LEGACY_HIDDEN_WIDGETS_KEY = 'om:portal:dashboard:hidden'
const HIDDEN_WIDGETS_KEY_PREFIX = 'om:portal:dashboard:hidden:v1:'
const HIDDEN_WIDGETS_VERSION = 1

function buildHiddenWidgetsKey(orgSlug: string, userId: string): string {
  return `${HIDDEN_WIDGETS_KEY_PREFIX}${orgSlug}:${userId}`
}

export function loadHiddenWidgets(orgSlug: string, userId: string): Set<string> {
  const hidden = readVersionedPreference<string[]>(
    buildHiddenWidgetsKey(orgSlug, userId),
    HIDDEN_WIDGETS_VERSION,
    isStringArray,
    [],
  )
  return new Set(hidden)
}

export function saveHiddenWidgets(orgSlug: string, userId: string, hidden: Set<string>): void {
  writeVersionedPreference(buildHiddenWidgetsKey(orgSlug, userId), HIDDEN_WIDGETS_VERSION, Array.from(hidden))
}

/** Drops the pre-scoping global key so stale preferences stop leaking across org/user contexts. */
export function clearLegacyHiddenWidgetsKey(): void {
  clearVersionedPreference(LEGACY_HIDDEN_WIDGETS_KEY)
}
