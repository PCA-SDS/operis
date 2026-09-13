/**
 * Canonical field-level validation schemas.
 *
 * Module `data/validators.ts` files should build on these rather than
 * re-deriving a rule per module — the same business concept validated three
 * different ways is how a client ends up accepting what the server rejects.
 * Where a module genuinely needs different rules, pass the options these
 * factories expose and say why in a comment.
 */
export { EMAIL_MAX_LENGTH, emailSchema, normalizeEmail, type EmailSchemaOptions } from './email'
export {
  CURRENCY_CODE_PATTERN,
  currencyCodeSchema,
  type CurrencyCodeSchemaOptions,
} from './currency'
export {
  MONEY_DEFAULT_SCALE,
  MONEY_MAX_AMOUNT,
  moneyAmountSchema,
  moneyDecimalStringSchema,
  type MoneyAmountSchemaOptions,
  type MoneyDecimalStringOptions,
} from './money'
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationQuerySchema,
  type PaginationSchemaOptions,
} from './pagination'
