import { EdgeState } from '../lib/status-colors'

interface WorkflowTransitionLabelProps {
  label: string
  state?: EdgeState
}

export function WorkflowTransitionLabel({
  label,
  state = 'pending',
}: WorkflowTransitionLabelProps) {
  if (!label) return null

  return (
    <div
      className={`
        px-2 py-1 text-xs font-medium
        bg-card border rounded
        ${state === 'completed' ? 'border-status-success-border text-status-success-text' : 'border-border text-muted-foreground'}
      `}
    >
      {label}
    </div>
  )
}
