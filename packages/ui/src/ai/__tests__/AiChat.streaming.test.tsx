/**
 * @jest-environment jsdom
 *
 * Streaming transcript regression guard.
 *
 * `<AiChat>` memoizes its transcript rows and their markdown parse, and no
 * longer keeps a redundant "stream tick" state to force re-renders. The only
 * thing driving a repaint mid-stream is `useAiChat` handing `setMessages` a
 * fresh array whose assistant entry is a fresh object. These tests pin that
 * contract down: every chunk must land, in order, while the stream is still
 * open — and the untouched rows around it must survive.
 */

// jsdom polyfills (same preamble as AiChat.test.tsx).
const nodeUtil = require('node:util') as typeof import('node:util')
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as any).TextEncoder = nodeUtil.TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as any).TextDecoder = nodeUtil.TextDecoder as unknown as typeof TextDecoder
}
const nodeStreamWeb = require('node:stream/web') as typeof import('node:stream/web')
if (typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  ;(globalThis as any).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('../../backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({
    ok: true,
    status: 200,
    result: {
      agentId: 'customers.account_assistant',
      allowRuntimeModelOverride: false,
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-5-mini',
      providers: [],
    },
  })),
}))

import { apiFetch } from '../../backend/utils/api'
import { AiChat } from '../AiChat'

const dict = {
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.thinking': 'Thinking...',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
  'ai_assistant.chat.userRoleLabel': 'You',
}

type ResponseLike = {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  headers?: { get: (name: string) => string | null }
  clone: () => ResponseLike
  json: () => Promise<unknown>
  text: () => Promise<string>
}

type ControllableStream = {
  response: ResponseLike
  push: (text: string) => Promise<void>
  close: () => Promise<void>
}

/**
 * A response whose body stays open so the test can feed it one chunk at a
 * time and assert what the transcript shows in between.
 */
function createControllableStream(options?: { sse?: boolean }): ControllableStream {
  const encoder = new TextEncoder()
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })
  const headers = options?.sse
    ? {
        get: (name: string) => {
          const normalized = name.toLowerCase()
          if (normalized === 'content-type') return 'text/event-stream'
          if (normalized === 'x-vercel-ai-ui-message-stream') return 'v1'
          return null
        },
      }
    : undefined
  const response: ResponseLike = {
    ok: true,
    status: 200,
    body,
    headers,
    clone: () => ({ ...response, body: null }),
    json: async () => ({}),
    text: async () => '',
  }
  return {
    response,
    push: async (text: string) => {
      await act(async () => {
        streamController?.enqueue(encoder.encode(text))
      })
    },
    close: async () => {
      await act(async () => {
        streamController?.close()
      })
    },
  }
}

function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function assistantText(): string {
  const row = document.querySelector('[data-role="assistant"] [data-ai-message-content]')
  return (row?.textContent ?? '').trim()
}

async function sendPrompt(prompt: string): Promise<void> {
  const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: prompt } })
  await act(async () => {
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
  })
}

describe('<AiChat> multi-chunk streaming', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('paints every plain-text chunk in order while the stream stays open', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    const stream = createControllableStream()
    fetchMock.mockResolvedValueOnce(stream.response)

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendPrompt('Summarise the account')

    await stream.push('The account ')
    await waitFor(() => {
      expect(assistantText()).toBe('The account')
    })

    await stream.push('is in good ')
    await waitFor(() => {
      expect(assistantText()).toBe('The account is in good')
    })

    await stream.push('standing.')
    await waitFor(() => {
      expect(assistantText()).toBe('The account is in good standing.')
    })

    // The user turn above the streaming row must survive every repaint.
    const userRow = document.querySelector('[data-role="user"]')
    expect(userRow?.textContent).toContain('Summarise the account')

    await stream.close()
    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    })
    expect(assistantText()).toBe('The account is in good standing.')
  })

  it('accumulates SSE text-delta chunks across separate reads', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    const stream = createControllableStream({ sse: true })
    fetchMock.mockResolvedValueOnce(stream.response)

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendPrompt('List the open deals')

    const deltas = ['Deal one. ', 'Deal two. ', 'Deal three. ', 'Deal four.']
    const expected = [
      'Deal one.',
      'Deal one. Deal two.',
      'Deal one. Deal two. Deal three.',
      'Deal one. Deal two. Deal three. Deal four.',
    ]

    for (let index = 0; index < deltas.length; index += 1) {
      await stream.push(sseEvent({ type: 'text-delta', id: 'text-1', delta: deltas[index] }))
      const snapshot = expected[index]
      await waitFor(() => {
        expect(assistantText()).toBe(snapshot)
      })
    }

    await stream.push('data: [DONE]\n\n')
    await stream.close()

    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    })
    expect(assistantText()).toBe('Deal one. Deal two. Deal three. Deal four.')
  })

  it('keeps a delta that arrives split across two reads', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    const stream = createControllableStream({ sse: true })
    fetchMock.mockResolvedValueOnce(stream.response)

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendPrompt('Explain the risk')

    const event = sseEvent({ type: 'text-delta', id: 'text-1', delta: 'Risk is low.' })
    const splitAt = Math.floor(event.length / 2)

    // First read carries an incomplete SSE frame — nothing may render yet.
    await stream.push(event.slice(0, splitAt))
    expect(assistantText()).toBe('')

    // Second read completes the frame; the whole delta must land.
    await stream.push(event.slice(splitAt))
    await waitFor(() => {
      expect(assistantText()).toBe('Risk is low.')
    })

    await stream.close()
    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    })
  })
})
