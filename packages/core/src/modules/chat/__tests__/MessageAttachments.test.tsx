/**
 * @jest-environment jsdom
 */

/**
 * How an image behaves before, during and after it loads.
 *
 * The reserved height is the part with a non-obvious consequence. An image row
 * that starts flat and grows when the bytes land pushes the transcript down
 * after it has already scrolled to the bottom, and the scroll that growth fires
 * tells `MessageList`'s follow-the-bottom rule that the reader has moved away —
 * so it stops re-pinning and the newest message is left half off the screen.
 * These pin the reservation so that regression cannot come back quietly.
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageAttachments } from '../components/MessageAttachments'
import type { ChatAttachmentDto } from '../data/types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(_key)
    if (!params) return text
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      text,
    )
  },
}))

function media(overrides: Partial<ChatAttachmentDto> = {}): ChatAttachmentDto {
  return {
    id: 'att-1',
    fileName: 'photo.png',
    mimeType: 'image/png',
    fileSize: 2048,
    kind: 'media',
    status: 'ready',
    createdAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  }
}

describe('message images', () => {
  it('reserves the height before the image arrives', () => {
    render(<MessageAttachments attachments={[media()]} />)
    const box = screen.getByRole('button', { name: 'Open photo.png' })
    // Some aspect box, so the row occupies its final height at first paint.
    expect(box.className).toMatch(/aspect-/)
    // And reads as a picture arriving rather than as a gap.
    expect(box.className).toContain('animate-pulse')
  })

  it('stops pulsing once the image has loaded', () => {
    render(<MessageAttachments attachments={[media()]} />)
    const box = screen.getByRole('button', { name: 'Open photo.png' })
    expect(box.className).toContain('animate-pulse')

    fireEvent.load(screen.getByAltText('photo.png'))

    // The whole point of the placeholder is that it goes away. If `onLoad`
    // stopped firing, every good image would pulse forever and nothing else in
    // this file would notice.
    expect(box.className).not.toContain('animate-pulse')
    expect(screen.getByAltText('photo.png')).toBeTruthy()
  })

  it('gives a lone image room and packs several into squares', () => {
    const { unmount } = render(<MessageAttachments attachments={[media()]} />)
    expect(screen.getByRole('button', { name: 'Open photo.png' }).className).toContain('aspect-video')
    unmount()

    render(
      <MessageAttachments
        attachments={[media(), media({ id: 'att-2', fileName: 'second.png' })]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Open photo.png' }).className).toContain('aspect-square')
  })

  it('draws thumbnails, never the original bytes', () => {
    render(<MessageAttachments attachments={[media()]} />)
    // A transcript that fetched originals would pull tens of megabytes to draw
    // pictures nobody has clicked.
    expect(screen.getByAltText('photo.png').getAttribute('src')).toBe(
      '/api/attachments/image/att-1/thumb',
    )
  })

  it('replaces an image that will not load with something the reader can act on', () => {
    render(<MessageAttachments attachments={[media()]} />)
    fireEvent.error(screen.getByAltText('photo.png'))

    // A broken-image glyph is the browser's answer, not ours.
    expect(screen.queryByAltText('photo.png')).toBeNull()
    expect(screen.getByText('Preview unavailable')).toBeTruthy()
    expect(screen.getByText('photo.png')).toBeTruthy()

    // The bytes may still be fine even when the derived thumbnail is not, so the
    // reader keeps a way to get the file.
    const download = screen.getByRole('link', { name: 'Download photo.png' })
    expect(download.getAttribute('href')).toBe('/api/attachments/file/att-1')
  })
})

describe('message files', () => {
  function file(overrides: Partial<ChatAttachmentDto> = {}): ChatAttachmentDto {
    return media({ id: 'file-1', fileName: 'report.pdf', kind: 'file', ...overrides })
  }

  it('offers no download while a file is still being checked', () => {
    render(<MessageAttachments attachments={[file({ status: 'pending' })]} />)
    expect(screen.getByText('Checking…')).toBeTruthy()
    // A control that leads nowhere is worse than no control.
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says why a rejected file cannot be opened, and offers no way to open it', () => {
    render(<MessageAttachments attachments={[file({ status: 'rejected' })]} />)
    expect(screen.getByText("Didn't pass the security check")).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders nothing at all when a cached payload predates attachments', () => {
    const { container } = render(<MessageAttachments />)
    expect(container.firstChild).toBeNull()
  })
})
