import { WorkflowStatus } from '../../lib/status-colors'

// Map old status values to new WorkflowStatus types
export function mapStatus(status?: string): WorkflowStatus {
  if (!status || status === 'pending') return 'not_started'
  if (status === 'running' || status === 'in_progress') return 'in_progress'
  if (status === 'completed') return 'completed'
  if (status === 'error') return 'not_started'
  return 'not_started'
}
