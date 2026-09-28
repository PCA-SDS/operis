export type CategoryTreeNode = {
  id: string
  name: string
  depth?: number
  pathLabel?: string
  isActive?: boolean
  selectable?: boolean
  children?: CategoryTreeNode[]
}
