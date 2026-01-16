import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

declare global {
  var prisma: PrismaClient | undefined
}

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/print-next.db'
})

export const prisma = globalThis.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma
}