'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { mapStatus } from './nodeStatus'

export interface UserTaskNodeData {
  label: string
  description?: string
  assignedTo?: string
  assignedToRoles?: string[]
  formKey?: string
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * UserTaskNode - User task step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export const UserTaskNode = memo(function UserTaskNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as UserTaskNodeData

  const workflowStatus = mapStatus(nodeData.status)

  return (
    <div className="user-task-node" title={nodeData.tooltip}>
      {/* Target Handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      <WorkflowNodeCard
        title={nodeData.label}
        description={nodeData.description}
        status={workflowStatus}
        nodeType="userTask"
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
