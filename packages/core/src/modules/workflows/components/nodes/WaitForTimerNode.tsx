'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { mapStatus } from './nodeStatus'

export interface WaitForTimerNodeData {
  label: string
  description?: string
  duration?: string
  until?: string
  config?: { duration?: string; until?: string }
  version?: number
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * WaitForTimerNode - Pauses workflow for a duration or until a specific datetime
 * Uses WorkflowNodeCard for consistent styling
 */
export const WaitForTimerNode = memo(function WaitForTimerNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as WaitForTimerNodeData

  const workflowStatus = mapStatus(nodeData.status)

  const duration = nodeData.duration || nodeData.config?.duration
  const until = nodeData.until || nodeData.config?.until
  const description = nodeData.description ||
    (duration ? `Wait for ${duration}` : until ? `Wait until ${until}` : 'Timer-based pause')

  return (
    <div className="wait-for-timer-node" title={nodeData.tooltip}>
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={description}
        status={workflowStatus}
        nodeType="waitForTimer"
        selected={selected}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
    </div>
  )
})
