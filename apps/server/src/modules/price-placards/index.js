export const apiBase = '/api/price-placards'
export const jsonParserLimit = '2mb'

export {
  DATABASE_PATH,
  closeDatabase,
  getDatabase,
  initializeDatabase,
  restoreDatabase,
  validateDatabaseFile,
} from './database.js'
export { createPricePlacardsRouter } from './router.js'
