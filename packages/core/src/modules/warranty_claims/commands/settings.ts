import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildOptimisticLockConflictBody } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { WarrantyClaimSettings } from '../data/entities'
import { toIsoOrNull as toIso } from '@open-mercato/shared/lib/date/normalize'
import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'
import {
  warrantyClaimSettingsSaveSchema,
  type WarrantyClaimSettingsSaveInput,
  type WarrantyClaimSettingsUpdateInput,
} from '../data/validators'
import {
  WARRANTY_CLAIM_SETTINGS_DEFAULTS,
  loadWarrantyClaimSettings,
  type WarrantyClaimEffectiveSettings, parseNullableNumber,
} from '../lib/settings'
import {
  enforceWarrantyClaimOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'

export const WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND = 'warranty_claims.settings'

export type SaveWarrantyClaimSettingsResult = WarrantyClaimEffectiveSettings & {
  settingsId: string
  returnWindowDays: number | null
  updatedAt: string | null
}

function parseCommandInput(rawInput: unknown): WarrantyClaimSettingsSaveInput {
  const parsed = warrantyClaimSettingsSaveSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
  }
  return parsed.data
}

function amountString(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function applySettingsUpdate(settings: WarrantyClaimSettings, input: WarrantyClaimSettingsUpdateInput): void {
  if (Object.hasOwn(input, 'slaHours') && input.slaHours !== undefined) settings.slaHours = input.slaHours
  if (Object.hasOwn(input, 'slaPauseOnInfoRequested') && input.slaPauseOnInfoRequested !== undefined) {
    settings.slaPauseOnInfoRequested = input.slaPauseOnInfoRequested
  }
  if (Object.hasOwn(input, 'slaAtRiskThresholdPct') && input.slaAtRiskThresholdPct !== undefined) {
    settings.slaAtRiskThresholdPct = input.slaAtRiskThresholdPct
  }
  if (Object.hasOwn(input, 'autoApproveEnabled') && input.autoApproveEnabled !== undefined) {
    settings.autoApproveEnabled = input.autoApproveEnabled
  }
  if (Object.hasOwn(input, 'autoApproveMaxAmount')) settings.autoApproveMaxAmount = amountString(input.autoApproveMaxAmount)
  if (Object.hasOwn(input, 'autoApproveCurrencyCode')) settings.autoApproveCurrencyCode = input.autoApproveCurrencyCode ?? null
  if (Object.hasOwn(input, 'autoApproveRequireInWarranty') && input.autoApproveRequireInWarranty !== undefined) {
    settings.autoApproveRequireInWarranty = input.autoApproveRequireInWarranty
  }
  if (Object.hasOwn(input, 'defaultWarrantyMonths')) settings.defaultWarrantyMonths = input.defaultWarrantyMonths ?? null
  if (Object.hasOwn(input, 'businessHours')) settings.businessHours = input.businessHours ?? null
  if (Object.hasOwn(input, 'escalationTiers')) settings.escalationTiers = input.escalationTiers ?? null
  if (Object.hasOwn(input, 'adjudicationUseRules') && input.adjudicationUseRules !== undefined) {
    settings.adjudicationUseRules = input.adjudicationUseRules
  }
  if (Object.hasOwn(input, 'quarantineGrades')) settings.quarantineGrades = input.quarantineGrades ?? null
  if (Object.hasOwn(input, 'returnLabelProvider')) settings.returnLabelProvider = input.returnLabelProvider ?? null
  if (Object.hasOwn(input, 'returnWindowDays')) settings.returnWindowDays = input.returnWindowDays ?? null
}

function assertAutoApproveConfig(settings: WarrantyClaimSettings): void {
  if (!settings.autoApproveEnabled) return
  if (settings.autoApproveMaxAmount !== null && settings.autoApproveMaxAmount !== undefined && settings.autoApproveCurrencyCode) return
  throw new CrudHttpError(400, { error: 'warranty_claims.errors.autoApproveConfigIncomplete' })
}

function buildResult(settings: WarrantyClaimSettings): SaveWarrantyClaimSettingsResult {
  return {
    settingsId: settings.id,
    slaHours: settings.slaHours,
    slaPauseOnInfoRequested: settings.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: settings.slaAtRiskThresholdPct,
    autoApproveEnabled: settings.autoApproveEnabled,
    autoApproveMaxAmount: parseNullableNumber(settings.autoApproveMaxAmount),
    autoApproveCurrencyCode: settings.autoApproveCurrencyCode ?? null,
    autoApproveRequireInWarranty: settings.autoApproveRequireInWarranty,
    defaultWarrantyMonths: settings.defaultWarrantyMonths ?? null,
    businessHours: settings.businessHours ?? null,
    escalationTiers: settings.escalationTiers ?? null,
    adjudicationUseRules: settings.adjudicationUseRules,
    quarantineGrades: settings.quarantineGrades ?? null,
    returnLabelProvider: settings.returnLabelProvider ?? null,
    returnWindowDays: settings.returnWindowDays ?? null,
    updatedAt: toIso(settings.updatedAt),
  }
}

const saveWarrantyClaimSettingsCommand: CommandHandler<
  WarrantyClaimSettingsSaveInput,
  SaveWarrantyClaimSettingsResult
> = {
  id: 'warranty_claims.settings.save',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadWarrantyClaimSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const exists = Boolean(settings)

    if (settings) {
      await enforceWarrantyClaimOptimisticLock(ctx, settings, WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND)
    } else {
      const now = new Date()
      settings = em.create(WarrantyClaimSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        slaHours: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaHours,
        slaPauseOnInfoRequested: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaPauseOnInfoRequested,
        slaAtRiskThresholdPct: WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaAtRiskThresholdPct,
        autoApproveEnabled: WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveEnabled,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveRequireInWarranty,
        defaultWarrantyMonths: WARRANTY_CLAIM_SETTINGS_DEFAULTS.defaultWarrantyMonths,
        businessHours: WARRANTY_CLAIM_SETTINGS_DEFAULTS.businessHours,
        escalationTiers: WARRANTY_CLAIM_SETTINGS_DEFAULTS.escalationTiers,
        adjudicationUseRules: WARRANTY_CLAIM_SETTINGS_DEFAULTS.adjudicationUseRules,
        quarantineGrades: WARRANTY_CLAIM_SETTINGS_DEFAULTS.quarantineGrades,
        returnLabelProvider: WARRANTY_CLAIM_SETTINGS_DEFAULTS.returnLabelProvider,
        returnWindowDays: null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(settings)
    }

    applySettingsUpdate(settings, input)
    assertAutoApproveConfig(settings)
    if (exists) settings.updatedAt = new Date()

    try {
      await em.flush()
    } catch (error) {
      if (exists || !isUniqueViolation(error)) throw error
      const retryEm = (ctx.container.resolve('em') as EntityManager).fork()
      const winner = await loadWarrantyClaimSettings(retryEm, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      if (!winner) throw error
      const currentUpdatedAt = toIso(winner.updatedAt)
      const expectedUpdatedAt = toIso(settings.updatedAt)
      if (currentUpdatedAt && expectedUpdatedAt) {
        throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentUpdatedAt, expectedUpdatedAt))
      }
      throw new CrudHttpError(409, { error: 'warranty_claims.errors.conflict' })
    }

    return buildResult(settings)
  },
}

registerCommand(saveWarrantyClaimSettingsCommand)

export const warrantyClaimSettingsCommands = [saveWarrantyClaimSettingsCommand]

export {
  saveWarrantyClaimSettingsCommand,
}
