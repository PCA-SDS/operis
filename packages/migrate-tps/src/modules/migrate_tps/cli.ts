import { migrateTpsBranchesCommand } from './branches'
import { migrateTpsCategoriesCommand } from './categories'
import { migrateTpsProductsCommand } from './products'
import { migrateTpsResourcesCommand } from './resources'
import { migrateTpsAllCommand } from './all'

export default [migrateTpsAllCommand, migrateTpsBranchesCommand, migrateTpsCategoriesCommand, migrateTpsProductsCommand, migrateTpsResourcesCommand]
