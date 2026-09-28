'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { mapStatus } from './nodeStatus'

export interface SubWorkflowNodeData {
  label: string
  description?: string
  subWorkflowId?: string
  subWorkflowName?: string
  version?: number
  status?: 'pending' | 'running' | 'completed' | 'error' | 'not_started' | 'in_progress'
  stepNumber?: number
  badge?: string
  tooltip?: string
  executionStatus?: 'completed' | 'active' | 'pending' | 'failed' | 'skipped'
}

/**
 * SubWorkflowNode - Sub-workflow invocation step in a workflow
 * Uses WorkflowNodeCard for consistent styling
 */
export const SubWorkflowNode = memo(function SubWorkflowNode({ data, isConnectable, selected }: NodeProps) {
  const nodeData = data as unknown as SubWorkflowNodeData

  const workflowStatus = mapStatus(nodeData.status)

  // Build description with sub-workflow info
  const description = nodeData.description ||
    (nodeData.subWorkflowName
      ? `Invokes: ${nodeData.subWorkflowName}${nodeData.version ? ` v${nodeData.version}` : ''}`
      : nodeData.subWorkflowId
        ? `Invokes: ${nodeData.subWorkflowId}`
        : 'Sub-workflow invocation')

  return (
    <div className="sub-workflow-node" title={nodeData.tooltip}>
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
        description={description}
        status={workflowStatus}
        nodeType="subWorkflow"
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
