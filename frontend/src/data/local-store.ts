import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 核对单签字记录：同一变电站同一装置只保留一条，重复提交就地覆盖。
const SIGN_STORAGE_KEY = 'substation-protection:check-signatures'
// 无 localStorage（如 SSR / 脚本环境）时的内存兜底。
let signatureMemory: CheckSignatureRecord[] = []

export type CheckSignatureRecord = {
  key: string
  station: string
  device: string
  signer: string
  signedAt: string
  hasMismatch: boolean
}

export function listSignatures(): CheckSignatureRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return signatureMemory
  }
  const raw = window.localStorage.getItem(SIGN_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CheckSignatureRecord[]) : []
  } catch {
    return []
  }
}

export function saveSignature(record: CheckSignatureRecord): CheckSignatureRecord[] {
  const next = listSignatures().filter((item) => item.key !== record.key)
  next.push(record)
  signatureMemory = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SIGN_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}
