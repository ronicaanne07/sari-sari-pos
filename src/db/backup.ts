import { ALL_TABLES, OPTIONAL_BACKUP_TABLES, db } from './db'
import { PosError } from './actions'

type TableName = (typeof ALL_TABLES)[number]

export interface BackupFile {
  app: 'tindahan-pos'
  version: 1 | 2 | 3 | 4 // 1 = before wallet/settings, 2 = before categories, 3 = before finance
  exportedAt: number
  tables: Partial<Record<TableName, unknown[]>>
}

export async function exportBackup(): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {}
  for (const name of ALL_TABLES) {
    // _dirty is a sync marker, not data: keep backups clean
    tables[name] = (await db[name].toArray()).map((row) => {
      const { _dirty, ...rest } = row as { _dirty?: number }
      void _dirty
      return rest
    })
  }
  return { app: 'tindahan-pos', version: 4, exportedAt: Date.now(), tables }
}

/**
 * Replaces ALL current data with the backup. Validates the shape first so a bad file changes
 * nothing. Backups from the first version of the app (no wallet transactions or settings) still load.
 */
export async function importBackup(raw: unknown): Promise<void> {
  const file = raw as Partial<BackupFile> | null
  if (!file || file.app !== 'tindahan-pos' || ![1, 2, 3, 4].includes(file.version as number) || !file.tables) {
    throw new PosError('This is not a Tindahan POS backup file')
  }
  const tables = file.tables
  for (const name of ALL_TABLES) {
    if (Array.isArray(tables[name])) continue
    if (!OPTIONAL_BACKUP_TABLES.includes(name)) throw new PosError(`Backup is missing "${name}"`)
  }
  await db.transaction('rw', ALL_TABLES.map((n) => db[n]), async () => {
    for (const name of ALL_TABLES) {
      await db[name].clear()
      // Rows keep their original ids so sales, items and utang entries stay linked.
      await (db[name] as unknown as { bulkAdd(rows: unknown[]): Promise<unknown> }).bulkAdd(tables[name] ?? [])
    }
  })
}

export async function resetAllData(): Promise<void> {
  await db.transaction('rw', [...ALL_TABLES.map((n) => db[n]), db.tombstones, db.syncMeta], async () => {
    for (const name of ALL_TABLES) await db[name].clear()
    await db.tombstones.clear()
    await db.syncMeta.clear() // a wiped phone downloads the shared store again
  })
}
