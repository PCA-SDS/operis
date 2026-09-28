import ts from 'typescript-js'

export function unwrapObjectLiteralExpression(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined
  if (ts.isObjectLiteralExpression(expression)) return expression
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapObjectLiteralExpression(expression.expression)
  }
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapObjectLiteralExpression(expression.expression)
  }
  return undefined
}
