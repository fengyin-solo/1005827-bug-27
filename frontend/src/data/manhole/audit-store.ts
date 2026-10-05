import type { AuditEntry } from './types'

// 养护留痕：谁、什么时候、想动哪口井、被哪道守卫放行或退回，都在这里，支持倒查。
const AUDIT_KEY = 'drainage-pump:manhole-audit'
const AUDIT_LIMIT = 500

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: AuditEntry[] | null = null

function readAudit(): AuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as AuditEntry[]
  } catch {
    return []
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUDIT_KEY) {
      cache = null
    }
  })
}

export function listAudit(): AuditEntry[] {
  if (cache === null) {
    cache = readAudit()
  }
  return cache
}

export function appendAudit(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
  const rows = clone(listAudit())
  const nextId = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const record: AuditEntry = {
    ...entry,
    id: nextId,
    at: new Date().toISOString(),
  }
  rows.unshift(record)
  const trimmed = rows.slice(0, AUDIT_LIMIT)
  cache = trimmed
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed))
  }
  return record
}

export function auditStorageKey(): string {
  return AUDIT_KEY
}
