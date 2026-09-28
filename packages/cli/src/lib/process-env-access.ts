import ts from 'typescript-js'

export function parseProcessEnvAccess(
  node: ts.Expression,
  env: NodeJS.ProcessEnv,
): { matched: boolean; value: string | undefined } {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const target = node.expression
    if (
      ts.isPropertyAccessExpression(target)
      && ts.isIdentifier(target.expression)
      && target.expression.text === 'process'
      && target.name.text === 'env'
    ) {
      return { matched: true, value: env[node.name.text] }
    }
  }

  if (
    ts.isElementAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env'
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return { matched: true, value: env[node.argumentExpression.text] }
  }

  return { matched: false, value: undefined }
}
