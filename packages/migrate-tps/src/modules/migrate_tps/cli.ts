import { migrateTpsBranchesCommand } from './branches'
import { migrateTpsCategoriesCommand } from './categories'
import { migrateTpsProductsCommand } from './products'
import { migrateTpsResourcesCommand } from './resources'
import { migrateTpsAllCommand } from './all'
import { migrateTpsPeopleCommand } from './people'
import { migrateTpsAppointmentsCommand } from './appointments'

export default [migrateTpsAllCommand, migrateTpsBranchesCommand, migrateTpsCategoriesCommand, migrateTpsProductsCommand, migrateTpsResourcesCommand, migrateTpsPeopleCommand, migrateTpsAppointmentsCommand]
