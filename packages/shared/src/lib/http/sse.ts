/**
 * The `data:` payload of one server-sent event block, with multi-line data
 * joined by newlines as the SSE format specifies, or `null` when the block
 * carries none (a comment or a bare `event:` line).
 */
export function readSseDataPayload(eventBlock: string): string | null {
  const lines = eventBlock.split('\n')
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5))
    }
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}
