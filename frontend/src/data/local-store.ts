import {
  MANHOLE_KEY,
  migrateManholeRows,
  type ManholeAuditEntry,
  type ManholeRecord,
} from './manhole-domain'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'
const AUDIT_KEY_PREFIX = 'drainage-pump:audit:'
const AUDIT_LIMIT = 500

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  return new Date().toISOString()
}

type RawState = {
  entries: Record<string, EntryRow[]>
  /** key 为模块键：该模块已完成一次责任口径迁移，不再重复处理。 */
  migrated: Record<string, boolean>
}

function readRaw(): RawState {
  const fallback: Record<string, EntryRow[]> = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return { entries: fallback, migrated: {} }
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return { entries: fallback, migrated: {} }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { entries: { ...fallback, ...parsed }, migrated: {} }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return { entries: fallback, migrated: {} }
  }
}

let cache: RawState | null = null
const migrationHooks: Record<string, (rows: EntryRow[]) => { rows: EntryRow[] }> = {
  [MANHOLE_KEY]: (rows) => {
    const result = migrateManholeRows(rows, nowText())
    for (const note of result.notes) {
      appendAudit(MANHOLE_KEY, {
        time: nowText(),
        actorId: 'system',
        actorName: '系统迁移',
        actorSegment: note.segmentName,
        action: '责任口径迁移',
        stage: '迁移重算',
        target: `${note.segmentName} / ${note.code}`,
        result: '通过',
        detail: `既有档保留原层级（原所属管段：${note.oldSegment || '空'}）；井体状态按新口径重算：${note.oldBody} → ${note.newBody}`,
      })
    }
    return { rows: result.rows }
  },
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readRaw()
  }
  return cache.entries
}

// 第一次读到某模块时，若该模块有迁移钩子则先补齐一次；之后不再重复。
function ensureMigrated(key: string): EntryRow[] {
  if (cache === null) {
    cache = readRaw()
  }
  const rows = cache.entries[key] ?? []
  if (cache.migrated[key]) {
    return rows
  }
  const hook = migrationHooks[key]
  const next = hook ? hook(rows).rows : rows
  cache.entries = { ...cache.entries, [key]: next }
  cache.migrated[key] = true
  persistEntries()
  return next
}

function persistEntries(): void {
  if (cache && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache.entries))
  }
}

export function listRows(key: string): EntryRow[] {
  return ensureMigrated(key)
}

export function listManholeRows(): ManholeRecord[] {
  return ensureMigrated(MANHOLE_KEY) as ManholeRecord[]
}

export function saveRows(key: string, rows: EntryRow[]): void {
  if (cache === null) {
    cache = readRaw()
  }
  cache.entries = { ...cache.entries, [key]: rows }
  cache.migrated[key] = true
  persistEntries()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  if (cache === null) {
    cache = readRaw()
  }
  cache.entries = { ...cache.entries, [key]: rows }
  cache.migrated[key] = false
  persistEntries()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(AUDIT_KEY_PREFIX + key)
  }
  // 种子重新播种后，按既有档再走一次责任口径迁移，保证口径一致。
  return ensureMigrated(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 审计留痕按模块独立存放，超出上限只保留最新的一批。
function readAudit(key: string): ManholeAuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY_PREFIX + key)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as ManholeAuditEntry[]
  } catch {
    return []
  }
}

export function listAudit(key: string): ManholeAuditEntry[] {
  const rows = readAudit(key)
  return [...rows].sort((a, b) => (a.id < b.id ? 1 : -1))
}

export function appendAudit(key: string, entry: Omit<ManholeAuditEntry, 'id'>): ManholeAuditEntry {
  const rows = readAudit(key)
  const id = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const full: ManholeAuditEntry = { id, ...entry }
  const next = [...rows, full].slice(-AUDIT_LIMIT)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY_PREFIX + key, JSON.stringify(next))
  }
  return full
}
