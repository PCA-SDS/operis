import {
  customTemplateValues,
  customTemplateVariables,
  renderHtmlPreviewWithSamples,
  renderWithSamples,
} from '../backend/email/templates/_components/TemplateBuilderForm'

describe('email template builder helpers', () => {
  it('keeps system variables out of the custom variable list', () => {
    expect(customTemplateVariables('companyName, quarterPeriod, greeting, vatPayable')).toEqual([
      'quarterPeriod',
      'vatPayable',
    ])
  })

  it('keeps system values out of persisted template defaults', () => {
    expect(customTemplateValues({
      companyName: 'Harborview Analytics',
      quarterPeriod: 'Quarter 1 2026',
      greeting: 'Dear Ms. Linh,',
      vatPayable: '1,000,000 VND',
    })).toEqual({
      quarterPeriod: 'Quarter 1 2026',
      vatPayable: '1,000,000 VND',
    })
  })

  it('renders sample values while leaving missing variables visible', () => {
    expect(renderWithSamples('Hello {{companyName}} for {{quarterPeriod}} / {{missingValue}}', {
      companyName: 'Harborview Analytics',
      quarterPeriod: 'Quarter 1 2026',
    })).toBe('Hello Harborview Analytics for Quarter 1 2026 / {{missingValue}}')
  })

  it('renders link variables as hyperlinks labelled by variable key', () => {
    expect(renderHtmlPreviewWithSamples('Upload here: {{uploadFolderUrl}}', {
      uploadFolderUrl: 'https://example.com/company-folder',
    }, {
      uploadFolderUrl: 'link',
    })).toBe('Upload here: <a href="https://example.com/company-folder" target="_blank" rel="noopener noreferrer">uploadFolderUrl</a>')
  })
})
