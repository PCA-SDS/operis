/**
 * Identifier case conversions. Two snake-case rules live here on purpose, and
 * they are not interchangeable:
 *
 * - `toSnakeCase` puts `_` before every capital and lowercases (`fooBar` →
 *   `foo_bar`, `URL` → `_u_r_l`). The encryption layer and the encrypted-sort
 *   path map entity properties to column names with it, so its output is part
 *   of how stored data is found — never change it.
 * - `camelToSnake` splits only a lowercase letter or digit followed by a capital,
 *   and turns spaces and dashes into `_` (`dealValue2X` → `deal_value2_x`,
 *   `due date` → `due_date`). Used for display keys, where readable input wins.
 */
export function toSnakeCase(value: string): string {
  return value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()
}

export function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

export function snakeToCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, char: string) => char.toUpperCase())
}
