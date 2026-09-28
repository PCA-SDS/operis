import { type EudrCriteriaAnswer, EUDR_CRITERIA_ANSWERS, EUDR_RISK_CONCLUSIONS } from '../data/validators'
import type { RiskCriteriaValue, RiskCriteriaEntry } from './RiskCriteriaField'
import { isRecord } from '@open-mercato/shared/lib/guards'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function isCriteriaAnswer(value: unknown): value is EudrCriteriaAnswer {
  return typeof value === 'string' && EUDR_CRITERIA_ANSWERS.some((answer) => answer === value)
}

export function normalizeCriteria(value: unknown): RiskCriteriaValue {
  if (!isRecord(value)) return {}
  const normalized: RiskCriteriaValue = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isCriteriaAnswer(entry.answer)) continue
    const note = normalizeOptionalString(entry.note)
    const nextEntry: RiskCriteriaEntry = note ? { answer: entry.answer, note } : { answer: entry.answer }
    normalized[key] = nextEntry
  }
  return normalized
}

export function conclusionOptions(translate: ReturnType<typeof useT>) {
  return EUDR_RISK_CONCLUSIONS.map((conclusion) => ({
    value: conclusion,
    label: translate(`eudr.conclusion.${conclusion}`),
  }))
}

export function toIsoDateTime(value: string | null): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
