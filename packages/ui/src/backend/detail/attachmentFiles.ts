import { type LucideIcon, FileText, FileSpreadsheet, FileArchive, FileCode, FileAudio, FileVideo, File } from 'lucide-react'

export function resolveFileExtension(fileName?: string | null): string {
  if (!fileName) return ''
  const normalized = fileName.trim()
  if (!normalized) return ''
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot === -1 || lastDot === normalized.length - 1) return ''
  return normalized.slice(lastDot + 1).toLowerCase()
}

export const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  md: FileText,
  rtf: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ods: FileSpreadsheet,
  ppt: FileText,
  pptx: FileText,
  zip: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  tgz: FileArchive,
  '7z': FileArchive,
  tar: FileArchive,
  json: FileCode,
  js: FileCode,
  ts: FileCode,
  jsx: FileCode,
  tsx: FileCode,
  html: FileCode,
  css: FileCode,
  xml: FileCode,
  yaml: FileCode,
  yml: FileCode,
  mp3: FileAudio,
  wav: FileAudio,
  flac: FileAudio,
  ogg: FileAudio,
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  webm: FileVideo,
}

export const MIME_FALLBACK_ICONS: Record<string, LucideIcon> = {
  audio: FileAudio,
  video: FileVideo,
  text: FileText,
  application: FileText,
}

export function resolveAttachmentPlaceholder(
  mimeType?: string | null,
  fileName?: string | null,
): { icon: LucideIcon; label: string } {
  const extension = resolveFileExtension(fileName)
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (extension && EXTENSION_ICON_MAP[extension]) {
    return { icon: EXTENSION_ICON_MAP[extension], label: extension.toUpperCase() }
  }
  if (!extension && normalizedMime.includes('pdf')) {
    return { icon: FileText, label: 'PDF' }
  }
  if (!extension && normalizedMime.includes('zip')) {
    return { icon: FileArchive, label: 'ZIP' }
  }
  if (!extension && normalizedMime.includes('json')) {
    return { icon: FileCode, label: 'JSON' }
  }
  const mimeRoot = normalizedMime.split('/')[0] || ''
  if (mimeRoot && MIME_FALLBACK_ICONS[mimeRoot]) {
    return { icon: MIME_FALLBACK_ICONS[mimeRoot], label: mimeRoot.toUpperCase() }
  }
  const fallbackSource = extension || mimeRoot || 'file'
  const fallbackLabel = fallbackSource.slice(0, 6).toUpperCase()
  return { icon: File, label: fallbackLabel }
}

export const ENV_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

export function resolveAbsoluteUrl(path: string): string {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  const base =
    ENV_APP_URL ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '')
  if (!base) return path
  const normalizedBase = base.replace(/\/$/, '')
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`
}
