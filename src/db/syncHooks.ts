import type Dexie from 'dexie'
import { newId } from './ids'

/**
 * Keeps every change to a shared table marked for upload.
 *
 *  _dirty  0/undefined = nothing to upload; N > 0 = changed N times since the last upload.
 *
 * The marker is written in the SAME transaction as the data, so a crash can never lose a change.
 * Rows written by the sync engine itself run in a transaction tagged `__remote`, which skips marking.
 */
type Tagged = { __remote?: boolean }

let listener: (() => void) | null = null
/** The sync engine registers here to upload soon after a local change. */
export function setLocalChangeListener(fn: (() => void) | null) {
  listener = fn
}

export function installSyncHooks(db: Dexie, tables: readonly string[]) {
  for (const name of tables) {
    const table = db.table(name)
    const auto = table.schema.primKey.auto
    table.hook('creating', function (pk, obj, trans) {
      const o = obj as { _dirty?: number }
      if ((trans as unknown as Tagged)?.__remote) {
        if (o._dirty === undefined) o._dirty = 0
      } else {
        o._dirty = 1
        listener?.()
      }
      if (pk === undefined && auto) return newId()
    })
    table.hook('updating', function (_mods, _pk, obj, trans) {
      if ((trans as unknown as Tagged)?.__remote) return
      listener?.()
      return { _dirty: ((obj as { _dirty?: number })._dirty ?? 0) + 1 }
    })
  }
}

/** Marks a transaction as "applying data that came from the server". */
export function markRemote(trans: unknown) {
  ;(trans as Tagged).__remote = true
}
