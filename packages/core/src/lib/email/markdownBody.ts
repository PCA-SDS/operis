import React from 'react'

/**
 * Renders a markdown message body to the HTML that goes on the wire.
 *
 * Markdown is an authoring format, not a delivery format: no mail client renders
 * it, so every path that turns a stored message body into an email has to run
 * this first. Keeping one implementation here is what makes the in-app view, the
 * built-in message email and the channel adapters agree on what a `markdown`
 * body looks like. It matches the in-app renderer
 * (`@open-mercato/ui/backend/markdown`), which is also react-markdown + remark-gfm.
 */
export async function renderMarkdownEmailBody(body: string): Promise<string> {
  const ReactMarkdownModule = await import('react-markdown')
  const remarkGfmModule = await import('remark-gfm')
  const ReactMarkdown =
    (ReactMarkdownModule.default ?? ReactMarkdownModule) as React.ComponentType<{
      remarkPlugins?: unknown
      children?: React.ReactNode
    }>
  const remarkGfmPlugin = remarkGfmModule.default ?? remarkGfmModule
  const { renderToStaticMarkup } = await import('react-dom/server')

  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfmPlugin] }, body),
  )
}
