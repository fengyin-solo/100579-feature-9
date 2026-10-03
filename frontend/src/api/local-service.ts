import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  resetRows,
  saveRows,
  saveSignature,
  listSignatures,
  type CheckSignatureRecord,
} from '@/data/local-store'
import type {
  ActionResult,
  CheckBoard,
  CheckConclusion,
  CheckItemVerdict,
  CheckSheet,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ── 定值核对：分栏视图、签字归集、待办联动 ──────────────────────────────

const STATION_FIELD = '所属变电站'
const DEVICE_FIELD = '装置名称'
const FIELD_VALUE = '现场定值'
const LEDGER_VALUE = '台账定值'
const CHECKER_FIELD = '核对人'
const CHECK_DATE_FIELD = '核对日期'
const CHECK_PENDING_STATUS = '待核对'
const CHECK_MATCH_STATUS = '核对一致'
const CHECK_MISMATCH_STATUS = '核对不符'
const SETTING_PENDING_STATUS = '待整定'

// 核对结论栏序：核对不符在最前，待出结论居中，核对一致收在末栏。
export const CHECK_COLUMNS: { conclusion: CheckConclusion; title: string }[] = [
  { conclusion: '核对不符', title: '核对不符' },
  { conclusion: '待出结论', title: '待出结论' },
  { conclusion: '核对一致', title: '核对一致' },
]

export function sheetKey(station: string, device: string): string {
  return `${station}|${device}`
}

/**
 * 条目结论只按现场实测那一份与台账定值比对：
 * 任一侧缺值即尚未出结论；状态字段不参与判定，冲突时以现场定值为准。
 */
export function itemVerdict(row: EntryRow): CheckItemVerdict {
  const field = String(row[FIELD_VALUE] ?? '').trim()
  const ledger = String(row[LEDGER_VALUE] ?? '').trim()
  if (!field || !ledger) {
    return 'pending'
  }
  return field === ledger ? 'match' : 'mismatch'
}

function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 按变电站分行、核对结论分栏；栏内按装置名称归集为核对单。 */
export function loadCheckBoard(filters: Record<string, string> = {}): CheckBoard {
  const rows = filterRows(listRows('settingcheck'), filters)
  const signatureByKey = new Map(listSignatures().map((item) => [item.key, item]))
  const stationOrder: string[] = []
  const grouped = new Map<string, CheckSheet[]>()

  const sheetMap = new Map<string, CheckSheet>()
  for (const row of rows) {
    const station = String(row[STATION_FIELD] ?? '')
    const device = String(row[DEVICE_FIELD] ?? '')
    const key = sheetKey(station, device)
    let sheet = sheetMap.get(key)
    if (!sheet) {
      const signature = signatureByKey.get(key)
      sheet = {
        key,
        station,
        device,
        items: [],
        mismatchItems: [],
        pendingItems: [],
        matchItems: [],
        conclusion: '待出结论',
        signed: Boolean(signature),
        signer: signature?.signer ?? '',
        signedAt: signature?.signedAt ?? '',
      }
      sheetMap.set(key, sheet)
      if (!stationOrder.includes(station)) {
        stationOrder.push(station)
      }
      if (!grouped.has(station)) {
        grouped.set(station, [])
      }
      grouped.get(station)!.push(sheet)
    }
    sheet.items.push(row)
  }

  for (const sheet of sheetMap.values()) {
    // 同一装置内：不符排最前，待实测居中，一致收后。
    sheet.items.sort((a, b) => {
      const rank: Record<CheckItemVerdict, number> = { mismatch: 0, pending: 1, match: 2 }
      return rank[itemVerdict(a)] - rank[itemVerdict(b)] || Number(a.id) - Number(b.id)
    })
    for (const item of sheet.items) {
      const verdict = itemVerdict(item)
      if (verdict === 'mismatch') {
        sheet.mismatchItems.push(item)
      } else if (verdict === 'pending') {
        sheet.pendingItems.push(item)
      } else {
        sheet.matchItems.push(item)
      }
    }
    sheet.conclusion = sheet.mismatchItems.length
      ? '核对不符'
      : sheet.pendingItems.length
        ? '待出结论'
        : '核对一致'
  }

  const stations = stationOrder.map((station) => {
    const sheets = grouped.get(station) ?? []
    // 栏内排序：不符条目越多越靠前，再按装置名称归集展示。
    sheets.sort((a, b) => b.mismatchItems.length - a.mismatchItems.length || a.device.localeCompare(b.device))
    const columns = {
      核对不符: sheets.filter((sheet) => sheet.conclusion === '核对不符'),
      待出结论: sheets.filter((sheet) => sheet.conclusion === '待出结论'),
      核对一致: sheets.filter((sheet) => sheet.conclusion === '核对一致'),
    } as Record<CheckConclusion, CheckSheet[]>
    return { station, columns }
  })

  return { columns: CHECK_COLUMNS, stations, sheets: [...sheetMap.values()] }
}

/**
 * 核对单签字：按装置名称归集后由核对人一次签字确认。
 * - 结论只按现场实测与台账定值比对，回写状态时与原结论冲突也以现场定值为准；
 * - 核对人写回每条记录，核对清单与核对单两处保持同一核对人；
 * - 出现不符即联动定值整定待办，同一张核对单重复提交只 upsert 一条。
 */
export function signCheckSheet(sheetKeyText: string, signer: string): ActionResult {
  const name = signer.trim()
  if (!name) {
    return { ok: false, message: '请填写核对人后再签字' }
  }
  const board = loadCheckBoard()
  const sheet = board.sheets.find((item) => item.key === sheetKeyText)
  if (!sheet) {
    return { ok: false, message: '没有找到这张核对单' }
  }
  if (sheet.pendingItems.length) {
    return {
      ok: false,
      message: `装置「${sheet.device}」还有 ${sheet.pendingItems.length} 条现场或台账定值未实测，无法出结论签字`,
    }
  }

  const hasMismatch = sheet.mismatchItems.length > 0
  const signedAt = todayText()
  const verdictStatus = hasMismatch ? CHECK_MISMATCH_STATUS : CHECK_MATCH_STATUS
  const pending = hasMismatch

  const checkRows = listRows('settingcheck')
  const idSet = new Set(sheet.items.map((item) => Number(item.id)))
  for (const row of checkRows) {
    if (!idSet.has(Number(row.id))) {
      continue
    }
    row.status = verdictStatus
    row.pending = pending
    row.abnormal = hasMismatch
    row[CHECKER_FIELD] = name
    row[CHECK_DATE_FIELD] = signedAt
  }
  saveRows('settingcheck', checkRows)

  if (hasMismatch) {
    upsertSettingTodo(sheet)
  } else {
    closeSettingTodo(sheet.key)
  }

  const record: CheckSignatureRecord = {
    key: sheet.key,
    station: sheet.station,
    device: sheet.device,
    signer: name,
    signedAt,
    hasMismatch,
  }
  saveSignature(record)

  return {
    ok: true,
    message: hasMismatch
      ? `核对单已签字：装置「${sheet.device}」核对不符，已联动定值整定待办 ${sheet.mismatchItems.length} 项`
      : `核对单已签字：装置「${sheet.device}」核对一致`,
  }
}

/** 判定不符后给定值整定待办清单追加一条；同一张核对单只保留一条。 */
function upsertSettingTodo(sheet: CheckSheet): void {
  const rows = listRows('settingvalue')
  const sourceKey = sheet.key
  const existingIndex = rows.findIndex((row) => String(row['来源核对单'] ?? '') === sourceKey)
  const todoId = `SETT-CHK-${String(hashCode(sheet.key)).slice(-5).padStart(5, '0')}`
  const todo: EntryRow = {
    id: existingIndex >= 0 ? rows[existingIndex].id : nextId(rows),
    status: SETTING_PENDING_STATUS,
    pending: true,
    abnormal: false,
    定值单号: todoId,
    所属装置: sheet.device,
    定值项目: `${sheet.device} 定值核对不符整改（${sheet.station}）`,
    整定值: sheet.mismatchItems.map((item) => String(item[FIELD_VALUE] ?? '')).join('；') || '以现场定值为准',
    计算依据: `现场实测与台账定值不符 ${sheet.mismatchItems.length} 项，核对单已签字确认，按现场定值重新整定`,
    整定人: '',
    审核人: '',
    定值状态: SETTING_PENDING_STATUS,
    来源核对单: sourceKey,
  }
  if (existingIndex >= 0) {
    rows[existingIndex] = { ...rows[existingIndex], ...todo, id: rows[existingIndex].id }
  } else {
    rows.push(todo)
  }
  saveRows('settingvalue', rows)
}

/** 重复签字改判为一致时，关掉此前由该核对单挂出的待办。 */
function closeSettingTodo(key: string): void {
  const rows = listRows('settingvalue')
  const index = rows.findIndex((row) => String(row['来源核对单'] ?? '') === key)
  if (index < 0) {
    return
  }
  const current = rows[index]
  if (String(current.status) === SETTING_PENDING_STATUS) {
    rows[index] = { ...current, status: '已作废', pending: false, 定值状态: '已作废' }
    saveRows('settingvalue', rows)
  }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function hashCode(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
