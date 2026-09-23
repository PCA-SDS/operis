import {
  ACCOUNTING_DEFAULT_FIELDS,
  isReservedEmailSystemVariable,
  mergeEmailTemplateVariables,
  withoutReservedEmailSystemVariables,
} from '../lib/accountingDefaults'

describe('email accounting defaults', () => {
  it('defines the approved tenant accounting variables', () => {
    expect(ACCOUNTING_DEFAULT_FIELDS).toEqual([
      'currentTaxQuarter',
      'currentAccountingPeriod',
      'financialYear',
      'accountingContactName',
      'accountingContactPhone',
      'paymentInstructions',
      'bankAccountReference',
      'defaultCurrency',
      'taxAuthorityName',
      'standardDisclaimer',
      'officeAddress',
    ])
  })

  it('removes reserved and non-string values before merging defaults', () => {
    expect(withoutReservedEmailSystemVariables({
      greeting: 'Dear customer,',
      companyName: 'Wrong company',
      currentTaxQuarter: 'Q3 2026',
      count: 3,
    })).toEqual({ currentTaxQuarter: 'Q3 2026' })
  })

  it('recognizes reserved variables after trimming the key', () => {
    expect(isReservedEmailSystemVariable(' greeting ')).toBe(true)
    expect(isReservedEmailSystemVariable('currentTaxQuarter')).toBe(false)
  })

  it('applies accounting, template, and compose precedence without overriding system variables', () => {
    expect(mergeEmailTemplateVariables(
      { greeting: 'Dear Linh,', companyName: 'Customer Ltd' },
      { currentTaxQuarter: 'Q2 2026', greeting: 'Wrong accounting greeting' },
      { currentTaxQuarter: 'Q3 2026', companyName: 'Wrong template company' },
      { currentTaxQuarter: 'Q4 2026', greeting: 'Wrong compose greeting' },
    )).toEqual({
      currentTaxQuarter: 'Q4 2026',
      greeting: 'Dear Linh,',
      companyName: 'Customer Ltd',
    })
  })
})
