/** @jest-environment node */

import {
  DEFAULT_PINNED_INTEGRATION_IDS,
  parsePinnedIntegrationIds,
  togglePinnedIntegrationId,
} from '../pinned'

describe('pinned integrations', () => {
  it('uses the default selection when nothing is stored', () => {
    expect(parsePinnedIntegrationIds(null)).toEqual([...DEFAULT_PINNED_INTEGRATION_IDS])
  })

  it('falls back to the defaults for unreadable stored values', () => {
    expect(parsePinnedIntegrationIds('not json')).toEqual([...DEFAULT_PINNED_INTEGRATION_IDS])
    expect(parsePinnedIntegrationIds('{"a":1}')).toEqual([...DEFAULT_PINNED_INTEGRATION_IDS])
  })

  it('keeps an empty stored selection so every integration can be hidden', () => {
    expect(parsePinnedIntegrationIds('[]')).toEqual([])
  })

  it('drops non-string and duplicate ids', () => {
    expect(parsePinnedIntegrationIds('["resend", 3, "", "resend", "ai_openai"]')).toEqual(['resend', 'ai_openai'])
  })

  it('adds and removes ids without duplicates', () => {
    expect(togglePinnedIntegrationId(['resend'], 'ai_openai', true)).toEqual(['resend', 'ai_openai'])
    expect(togglePinnedIntegrationId(['resend', 'ai_openai'], 'resend', true)).toEqual(['ai_openai', 'resend'])
    expect(togglePinnedIntegrationId(['resend', 'ai_openai'], 'resend', false)).toEqual(['ai_openai'])
  })
})
