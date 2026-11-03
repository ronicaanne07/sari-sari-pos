import { ALL_TABLES, db } from './db'
import { PosError } from './actions'

export interface BackupFile {
  app: 'tindahan-pos'
  version: 1
  exportedAt: number
  tables: Record<(typeof ALL_TABLES)[number], unknown[]>
}

export async function exportBackup(): Promise<BackupFile> {
  const tables = {} as BackupFile['tables']
  for (const name of ALL_TABLES) tables[name] = await db[name].toArray()
  return { app: 'tindahan-pos', version: 1, exportedAt: Date.now(), tables }
}

/** Replaces ALL current data with the backup. Validates the shape first so a bad file changes nothing. */
export async function importBackup(raw: unknown): Promise<void> {
  const file = raw as Partial<BackupFile> | null
  if (!file || file.app !== 'tindahan-pos' || file.version !== 1 || !file.tables) {
    throw new PosError('This is not a Tindahan POS backup file')
  }
  for (const name of ALL_TABLES) {
    if (!Array.isArray(file.tables[name])) throw new PosError(`Backup is missing "${name}"`)
  }
  const tables = file.tables
  await db.transaction('rw', ALL_TABLES.map((n) => db[n]), async () => {
    for (const name of ALL_TABLES) {
      await db[name].clear()
      // Rows keep their original ids so sales, items and utang entries stay linked.
      await (db[name] as unknown as { bulkAdd(rows: unknown[]): Promise<unknown> }).bulkAdd(tables[name])
    }
  })
}

export async function resetAllData(): Promise<void> {
  await db.transaction('rw', ALL_TABLES.map((n) => db[n]), async () => {
    for (const name of ALL_TABLES) await db[name].clear()
  })
}
