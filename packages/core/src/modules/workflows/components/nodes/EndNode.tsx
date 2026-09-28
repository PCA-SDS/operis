'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { mapStatus } from './nodeStatus'

export interface EndNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  outcome?: 'success' | 'cancelled' | 'error'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * EndNode - End point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export const EndNode = memo(function EndNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as EndNodeData

  const workflowStatus = mapStatus(nodeData.status)

  return (
    <div className="end-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label || 'Complete'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="end"
        selected={selected}
      />
    </div>
  )
})
