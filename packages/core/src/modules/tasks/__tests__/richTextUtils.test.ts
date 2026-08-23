/**
 * @jest-environment jsdom
 */
import { htmlToPlainText, trimRichText } from '../components/richTextUtils'

describe('htmlToPlainText', () => {
  it('reads the text out of markup', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('returns nothing for markup with no text', () => {
    expect(htmlToPlainText('<p></p><p><br></p>')).toBe('')
  })
})

describe('trimRichText', () => {
  it('treats visually empty markup as empty', () => {
    for (const html of ['', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<p>  </p><p><br></p>']) {
      expect(trimRichText(html)).toEqual({ html: '', text: '' })
    }
  })

  it('drops trailing blank paragraphs a user left behind', () => {
    const result = trimRichText('<p>Real content</p><p><br></p><p></p>')
    expect(result.text).toBe('Real content')
    expect(result.html).not.toContain('<br>')
  })

  it('drops leading blank paragraphs', () => {
    const result = trimRichText('<p><br></p><p>Real content</p>')
    expect(result.text).toBe('Real content')
    expect(result.html.startsWith('<p>Real')).toBe(true)
  })

  it('keeps the content between the trimmed edges intact', () => {
    const result = trimRichText('<p><br></p><p>One</p><p><br></p><p>Two</p><p><br></p>')
    expect(result.html).toContain('<p>One</p>')
    expect(result.html).toContain('<p>Two</p>')
    // The blank line the author put *between* the paragraphs is theirs to keep.
    expect(result.html).toContain('<p><br></p>')
  })

  it('keeps a paragraph that carries media but no text', () => {
    const result = trimRichText('<p><img src="/a.png" alt="chart"></p>')
    expect(result.html).toContain('<img')
  })

  it('trims whitespace inside the edge text nodes', () => {
    const result = trimRichText('<p>   Real content   </p>')
    expect(result.html).toBe('<p>Real content</p>')
  })
})
