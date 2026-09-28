'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { mapStatus } from './nodeStatus'

export interface StartNodeData {
  label: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * StartNode - Starting point of a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export const StartNode = memo(function StartNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as StartNodeData

  const workflowStatus = mapStatus(nodeData.status)

  return (
    <div className="start-node" title={nodeData.tooltip}>
      <WorkflowNodeCard
        title={nodeData.label || 'Start'}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="start"
        selected={selected}
      />

      {/* Source Handle */}
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
