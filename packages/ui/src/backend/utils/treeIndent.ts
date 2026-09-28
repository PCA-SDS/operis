export const TREE_BASE_INDENT = 18

export const TREE_STEP_INDENT = 14

export function computeIndent(depth: number): number {
  if (depth <= 0) return 0
  return TREE_BASE_INDENT + (depth - 1) * TREE_STEP_INDENT
}
