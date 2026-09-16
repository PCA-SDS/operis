import {
  blocksFromRecord,
  blocksToHtml,
  createStaticBlock,
  customTemplateValues,
  customTemplateVariables,
  renderHtmlPreviewWithSamples,
  renderWithSamples,
} from '../components/templateHtml'
import { buildTemplateApiPayload, type TemplateBuilderFormValue } from '../components/templatePayload'

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

  it('renders one greeting line per linked person', () => {
    expect(renderHtmlPreviewWithSamples('<p>{{greeting}}</p>', {
      greeting: 'Dear Ms. Linh,\nDear Mr. David,',
    }, {})).toBe('<p>Dear Ms. Linh,<br />Dear Mr. David,</p>')
  })
})

/**
 * The builder and the compose page each had their own reader of the stored
 * body. They disagreed on two points, and each disagreement rendered the same
 * template two different ways depending on which page you opened.
 */
describe('blocksFromRecord — one reader for the persisted body', () => {
  it('resolves the legacy `rich_text` type to rich text, not an escaped paragraph', () => {
    const blocks = blocksFromRecord(
      [{ id: 'b1', type: 'rich_text', props: { html: '<p><strong>Hi</strong></p>' } }],
      {},
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('rich-text-html')
    expect(blocks[0]?.content).toBe('<p><strong>Hi</strong></p>')
  })

  it('falls back to design.body.html when a migrated row carries no blocks', () => {
    const blocks = blocksFromRecord([], { body: { format: 'blocks+html', html: '<p>Migrated body</p>' } })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('rich-text-html')
    expect(blocks[0]?.content).toBe('<p>Migrated body</p>')
  })

  it('parses a jsonb column that arrived as a JSON string', () => {
    const blocks = blocksFromRecord('[{"id":"b1","type":"heading","props":{"text":"Title"}}]', {})
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.content).toBe('Title')
  })

  it('returns nothing when the record holds no body, so callers choose the fallback', () => {
    expect(blocksFromRecord(null, null)).toEqual([])
    expect(blocksFromRecord([], { body: { html: '' } })).toEqual([])
  })

  it('never labels a block with a hardcoded English string', () => {
    const blocks = blocksFromRecord([{ id: 'b1', type: 'divider' }], {})
    expect(blocks[0]?.label).toBe('divider')
  })
})

describe('blocksToHtml', () => {
  it('escapes every block type except the sanitized rich-text one', () => {
    const html = blocksToHtml([
      createStaticBlock('h', 'heading', '<script>alert(1)</script>'),
      createStaticBlock('p', 'paragraph', 'a & b'),
      createStaticBlock('r', 'rich-text-html', '<p onclick="alert(1)">safe</p>'),
    ])
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
    expect(html).not.toMatch(/onclick/i)
  })

  it('rejects a non-http button href rather than emitting it', () => {
    const html = blocksToHtml([createStaticBlock('b', 'button', 'Pay', 'javascript:alert(1)')])
    expect(html).toContain('href="#"')
    expect(html).not.toMatch(/javascript:/i)
  })

  it('takes the empty-button label from the caller so it can be translated', () => {
    const html = blocksToHtml([createStaticBlock('b', 'button', '', 'https://example.com')], 'Otwórz link')
    expect(html).toContain('Otwórz link')
  })
})

describe('buildTemplateApiPayload — one body for create and edit', () => {
  const form: TemplateBuilderFormValue = {
    templateKey: ' quarterly-vat ',
    name: '  Quarterly VAT  ',
    description: '',
    category: '',
    status: 'published',
    subject: ' VAT for {{companyName}} ',
    preheader: '',
    variables: 'companyName, quarterPeriod',
    fields: 'quarterPeriod',
    defaultValues: '{"quarterPeriod":"Q1 2026","companyName":"Ignored"}',
    variableTypes: '{"quarterPeriod":"text"}',
    rules: '{"type":"tax_report"}',
    ruleNotes: '',
    workflowKey: 'tax_report',
    sortOrder: '3',
    isActive: true,
    blocks: [createStaticBlock('b1', 'paragraph', 'Hello {{companyName}}')],
  }

  it('trims, defaults the category, and drops system variables from the persisted defaults', () => {
    const payload = buildTemplateApiPayload(form)
    expect(payload.template_key).toBe('quarterly-vat')
    expect(payload.name).toBe('Quarterly VAT')
    expect(payload.category).toBe('accounting')
    expect(payload.subject).toBe('VAT for {{companyName}}')
    expect(payload.variables).toEqual(['quarterPeriod'])
    expect(payload.accounting_metadata.defaultValues).toEqual({ quarterPeriod: 'Q1 2026' })
    expect(payload.accounting_metadata.sortOrder).toBe(3)
  })

  it('keeps design.body.html rendered from the same blocks it persists', () => {
    const payload = buildTemplateApiPayload(form)
    expect(payload.blocks).toHaveLength(1)
    expect(payload.design.body.html).toBe(blocksToHtml(form.blocks))
    // Round-trips: the one reader recovers the body the writer stored.
    expect(blocksFromRecord(payload.blocks, payload.design)[0]?.content).toBe('Hello {{companyName}}')
  })

  it('never marks an archived template active in the compose picker', () => {
    const payload = buildTemplateApiPayload({ ...form, status: 'archived' })
    expect(payload.accounting_metadata.isActive).toBe(false)
  })
})
