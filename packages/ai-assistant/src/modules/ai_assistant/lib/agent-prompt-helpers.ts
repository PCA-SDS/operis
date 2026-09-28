import type { PromptSection, PromptTemplate } from './prompt-composition-types'

export function textFromMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .join(' ')
}

export function latestUserTextFromPrepareStepState(state: unknown): string {
  const messages = (state as { messages?: unknown })?.messages
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    if (record.role !== 'user') continue
    return textFromMessageContent(record.content)
  }
  return ''
}

export function isMetaHelpPrompt(text: string): boolean {
  const normalized = text.toLowerCase()
  if (!normalized.trim()) return false
  const asksForQuestionIdeas =
    (normalized.includes('question') || normalized.includes('questions')) &&
    (normalized.includes('could ask') ||
      normalized.includes('can ask') ||
      normalized.includes('ask you') ||
      normalized.includes('suggest') ||
      normalized.includes('examples'))
  const asksForCapabilities =
    normalized.includes('what can you do') ||
    normalized.includes('how can you help') ||
    normalized.includes('what should i ask') ||
    normalized.includes('what can i ask')
  return asksForQuestionIdeas || asksForCapabilities
}

export function compilePromptTemplate(template: PromptTemplate): string {
  return template.sections
    .slice()
    .sort((a: PromptSection, b: PromptSection) => (a.order ?? 0) - (b.order ?? 0))
    .map((section: PromptSection) => section.content.trim())
    .join('\n\n')
}

export function renderContextBlock(label: string, payload: unknown): string {
  return `## Page context — ${label}\n${JSON.stringify(payload, null, 2)}`
}
