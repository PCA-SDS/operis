import { camelToSnake, snakeToCamel, toSnakeCase } from '../string/case'

describe('case conversions', () => {
  it('keeps the storage mapping rule of toSnakeCase', () => {
    expect(toSnakeCase('fooBar')).toBe('foo_bar')
    expect(toSnakeCase('URL')).toBe('_u_r_l')
    expect(toSnakeCase('already_snake')).toBe('already_snake')
  })

  it('splits only lower-to-upper boundaries in camelToSnake', () => {
    expect(camelToSnake('dealValue2X')).toBe('deal_value2_x')
    expect(camelToSnake('due date')).toBe('due_date')
    expect(camelToSnake('due-date')).toBe('due_date')
  })

  it('converts snake and kebab case to camel case', () => {
    expect(snakeToCamel('deal_value')).toBe('dealValue')
    expect(snakeToCamel('due-date')).toBe('dueDate')
  })
})
