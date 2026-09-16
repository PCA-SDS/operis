import { plainTextToTaskHtml } from '../components/format'

/**
 * A task description is a rich-text column, sanitized on write and rendered with
 * `dangerouslySetInnerHTML`. The promise this flow makes is that the stored task
 * says what the writer reviewed, so the conversion has to survive that round trip.
 */
describe('plainTextToTaskHtml', () => {
  it('keeps paragraphs that blank lines separated', () => {
    expect(plainTextToTaskHtml('First para\n\nSecond para')).toBe('<p>First para</p><p>Second para</p>')
  })

  it('keeps single line breaks, which raw text in an HTML column loses', () => {
    expect(plainTextToTaskHtml('line one\nline two')).toBe('<p>line one<br />line two</p>')
  })

  /**
   * The case that made this necessary. As raw text the sanitizer read `<service>`
   * as an unknown tag and dropped it, so the task said "deploy  first" — different
   * from the message the writer was shown and approved.
   */
  it('escapes angle-bracketed words instead of letting them be read as tags', () => {
    expect(plainTextToTaskHtml('deploy <service> first')).toBe('<p>deploy &lt;service&gt; first</p>')
  })

  it('escapes markup that would otherwise survive sanitisation', () => {
    expect(plainTextToTaskHtml('<b>bold</b>')).toBe('<p>&lt;b&gt;bold&lt;/b&gt;</p>')
    expect(plainTextToTaskHtml('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })

  it('escapes ampersands once, so "&amp;" does not become "&amp;amp;" on a round trip', () => {
    expect(plainTextToTaskHtml('Tom & Jerry')).toBe('<p>Tom &amp; Jerry</p>')
  })

  it('drops empty paragraphs rather than emitting blank ones', () => {
    expect(plainTextToTaskHtml('one\n\n\n\ntwo')).toBe('<p>one</p><p>two</p>')
    expect(plainTextToTaskHtml('')).toBe('')
  })
})
