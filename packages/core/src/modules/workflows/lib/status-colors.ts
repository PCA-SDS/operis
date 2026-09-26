export type WorkflowStatus = 'completed' | 'in_progress' | 'pending' | 'not_started'

export const STATUS_COLORS = {
  completed: {
    bg: 'bg-status-success-bg',
    border: 'border-status-success-border',
    text: 'text-status-success-text',
    icon: 'text-status-success-icon',
    color: 'var(--status-success-icon)',
  },
  in_progress: {
    bg: 'bg-status-info-bg',
    border: 'border-status-info-border',
    text: 'text-status-info-text',
    icon: 'text-status-info-icon',
    color: 'var(--status-info-icon)',
  },
  pending: {
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
    icon: 'text-status-warning-icon',
    color: 'var(--status-warning-icon)',
  },
  not_started: {
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-foreground',
    icon: 'text-muted-foreground',
    color: 'var(--muted-foreground)',
  },
} as const

export type EdgeState = 'completed' | 'pending'

export const EDGE_COLORS = {
  completed: {
    stroke: 'var(--status-success-icon)',
    strokeClass: 'stroke-status-success-icon',
    dashed: false,
  },
  pending: {
    stroke: 'var(--muted-foreground)',
    strokeClass: 'stroke-muted-foreground',
    dashed: true,
  },
} as const
