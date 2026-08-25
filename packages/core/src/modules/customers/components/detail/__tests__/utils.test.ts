import { resolveTodoHref } from '../utils'

describe('resolveTodoHref', () => {
  it('deep links into the module that owns the task', () => {
    expect(resolveTodoHref('tasks:task', '11111111-1111-1111-1111-111111111111')).toBe(
      '/backend/tasks/todos/11111111-1111-1111-1111-111111111111/edit',
    )
  })

  it('keeps canonical interaction tasks non-linkable without an external integration href', () => {
    expect(resolveTodoHref('customers:interaction', '11111111-1111-1111-1111-111111111111')).toBeNull()
  })

  it('links when the caller can reach the owning module', () => {
    expect(
      resolveTodoHref('tasks:task', '11111111-1111-1111-1111-111111111111', new Set(['customers', 'tasks'])),
    ).toBe('/backend/tasks/todos/11111111-1111-1111-1111-111111111111/edit')
  })

  it('drops the link when the owning module is withheld from the caller', () => {
    // The task row survives a module being withheld — its source string still
    // names that module — so the href, not the row, is what has to disappear.
    expect(
      resolveTodoHref('tasks:task', '11111111-1111-1111-1111-111111111111', new Set(['customers'])),
    ).toBeNull()
  })

  it('does not gate when no entitlement context was supplied', () => {
    expect(resolveTodoHref('tasks:task', '11111111-1111-1111-1111-111111111111', null)).toBe(
      '/backend/tasks/todos/11111111-1111-1111-1111-111111111111/edit',
    )
  })
})
