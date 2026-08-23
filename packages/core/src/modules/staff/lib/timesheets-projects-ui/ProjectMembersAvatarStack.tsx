"use client"

import * as React from 'react'

export type AvatarMember = {
  id: string
  name: string
  initials: string
  avatarUrl?: string | null
}

export type ProjectMembersAvatarStackProps = {
  members: AvatarMember[]
  total: number
  peopleCountLabel: string
  className?: string
}

const AVATAR_PALETTE = [
  'bg-status-info-bg text-status-info-text',
  'bg-status-success-bg text-status-success-text',
  'bg-status-warning-bg text-status-warning-text',
  'bg-status-error-bg text-status-error-text',
  'bg-status-pink-bg text-status-pink-text',
  'bg-status-info-bg text-status-info-text',
]

function pickPalette(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

export function ProjectMembersAvatarStack({
  members,
  total,
  peopleCountLabel,
  className,
}: ProjectMembersAvatarStackProps) {
  const visible = members.slice(0, 4)
  const overflow = Math.max(0, total - visible.length)

  if (total === 0) {
    return <span className={`text-xs text-muted-foreground ${className ?? ''}`}>—</span>
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div className="flex -space-x-1.5">
        {visible.map((member) => (
          <span
            key={member.id}
            title={member.name}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-background text-overline font-semibold ${pickPalette(member.id)}`}
          >
            {member.initials}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-overline font-semibold text-foreground"
            title={`+${overflow}`}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">{peopleCountLabel}</span>
    </div>
  )
}
