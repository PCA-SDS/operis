"use client"

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ConditionRow } from './ConditionRow'
import type { GroupCondition, ConditionExpression, SimpleCondition } from './utils/conditionValidation'
import type { LogicalOperator } from './../data/validators'
import { isGroupCondition, getLogicalOperators } from './utils/conditionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ConditionGroupProps = {
  group: GroupCondition
  onChange: (group: GroupCondition) => void
  onDelete?: () => void
  depth: number
  maxDepth?: number
  entityType?: string
}

/* Nesting depth is a CATEGORICAL signal — a group three levels deep is not
   "a warning". The cycle uses the token families purely to stay distinguishable,
   and needs no `dark:` overrides because every status token carries its own
   dark value. */
const DEPTH_COLORS = [
  'border-status-info-border bg-status-info-bg',
  'border-status-success-border bg-status-success-bg',
  'border-status-pink-border bg-status-pink-bg',
  'border-status-warning-border bg-status-warning-bg',
  'border-status-neutral-border bg-status-neutral-bg',
]

export function ConditionGroup({ group, onChange, onDelete, depth, maxDepth = 5, entityType }: ConditionGroupProps) {
  const t = useT()
  const logicalOperators = getLogicalOperators(t)
  const colorClass = DEPTH_COLORS[depth % DEPTH_COLORS.length]

  const handleOperatorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...group,
      operator: e.target.value as LogicalOperator,
    })
  }

  const handleRuleChange = (index: number, updatedRule: ConditionExpression) => {
    const newRules = [...group.rules]
    newRules[index] = updatedRule
    onChange({
      ...group,
      rules: newRules,
    })
  }

  const handleDeleteRule = (index: number) => {
    const newRules = group.rules.filter((_, i) => i !== index)
    if (newRules.length === 0) {
      // If no rules left, delete the group itself
      onDelete?.()
    } else {
      onChange({
        ...group,
        rules: newRules,
      })
    }
  }

  const addSimpleCondition = () => {
    const newCondition: SimpleCondition = {
      field: '',
      operator: '=',
      value: null,
    }
    onChange({
      ...group,
      rules: [...group.rules, newCondition],
    })
  }

  const addConditionGroup = () => {
    if (depth >= maxDepth) {
      alert(t('business_rules.components.conditionGroup.maxDepthReached', { maxDepth }))
      return
    }

    const newGroup: GroupCondition = {
      operator: 'AND',
      rules: [
        {
          field: '',
          operator: '=',
          value: null,
        },
      ],
    }
    onChange({
      ...group,
      rules: [...group.rules, newGroup],
    })
  }

  return (
    <div
      className={`p-3 rounded border-2 ${colorClass}`}
      style={{ marginLeft: depth > 0 ? `${depth * 16}px` : '0' }}
    >
      {/* Group Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t('business_rules.components.conditionGroup.group', { depth: depth + 1 })}
        </span>
        <Select
          value={group.operator}
          onValueChange={(value) => handleOperatorChange({ target: { value } } as React.ChangeEvent<HTMLSelectElement>)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-[6rem] font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {logicalOperators.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          ({t('business_rules.components.conditionGroup.ruleCount', { count: group.rules.length })})
        </span>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto p-1 text-muted-foreground hover:text-status-error-text hover:bg-status-error-bg rounded transition-colors"
            title={t('business_rules.components.conditionGroup.deleteGroup')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Rules */}
      <div className="space-y-2">
        {group.rules.map((rule, index) => (
          <div key={index}>
            {isGroupCondition(rule) ? (
              // Recursive: Nested Group
              <ConditionGroup
                group={rule}
                onChange={(updatedGroup) => handleRuleChange(index, updatedGroup)}
                onDelete={() => handleDeleteRule(index)}
                depth={depth + 1}
                maxDepth={maxDepth}
                entityType={entityType}
              />
            ) : (
              // Base Case: Simple Condition
              <ConditionRow
                condition={rule}
                onChange={(updatedCondition) => handleRuleChange(index, updatedCondition)}
                onDelete={() => handleDeleteRule(index)}
                entityType={entityType}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add Buttons */}
      <div className="flex gap-2 mt-3">
        <Button
          type="button"
          onClick={addSimpleCondition}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          {t('business_rules.components.conditionGroup.addCondition')}
        </Button>

        {depth < maxDepth && (
          <Button
            type="button"
            onClick={addConditionGroup}
            variant="outline"
            size="sm"
            className="text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            {t('business_rules.components.conditionGroup.addGroup', { depth: depth + 2 })}
          </Button>
        )}
      </div>
    </div>
  )
}
