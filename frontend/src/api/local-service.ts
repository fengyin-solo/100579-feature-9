import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SettingcheckBoard,
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
  if (key === 'settingcheck') {
    syncSettingTodo(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// —— 定值核对：结论判定、分栏看板与不符联动 ——

const CHECK_CONSISTENT = '核对一致'
const CHECK_MISMATCH = '核对不符'

// 核对结论只按现场实测那一份判定：现场定值与台账定值对不上就是不符，
// 与其他结论冲突时以现场定值为准。
export function checkConclusion(row: EntryRow): string {
  const status = String(row.status)
  if (status !== CHECK_CONSISTENT && status !== CHECK_MISMATCH) {
    return status
  }
  const field = String(row['现场定值'] ?? '').trim()
  const ledger = String(row['台账定值'] ?? '').trim()
  return field === ledger ? CHECK_CONSISTENT : CHECK_MISMATCH
}

// 同一张核对单重复提交只留一条：按核对编号去重，保留最新登记的那条。
function dedupeCheckRows(rows: EntryRow[]): EntryRow[] {
  const byCode = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row['核对编号'] ?? '').trim()
    byCode.set(code === '' ? `__row_${row.id}` : code, row)
  }
  return [...byCode.values()]
}

// 按所属变电站分行、核对结论分栏：核对不符排最前一栏，核对一致收进末栏，
// 栏内按装置名称归集，核对清单与核对单两处的核对人取自同一条记录，保持一致。
export function settingcheckBoard(): SettingcheckBoard {
  const meta = moduleMeta('settingcheck')
  const conclusions = [
    CHECK_MISMATCH,
    ...meta.statuses.filter((status) => status !== CHECK_CONSISTENT && status !== CHECK_MISMATCH),
    CHECK_CONSISTENT,
  ]
  const totals: Record<string, number> = Object.fromEntries(
    conclusions.map((conclusion) => [conclusion, 0]),
  )
  const stations = new Map<string, Map<string, Map<string, EntryRow[]>>>()
  for (const row of dedupeCheckRows(listRows('settingcheck'))) {
    const conclusion = checkConclusion(row)
    totals[conclusion] = (totals[conclusion] ?? 0) + 1
    const station = String(row['所属变电站'] ?? '').trim() || '未填写变电站'
    const device = String(row['装置名称'] ?? '').trim() || '未命名装置'
    let byConclusion = stations.get(station)
    if (!byConclusion) {
      byConclusion = new Map()
      stations.set(station, byConclusion)
    }
    let byDevice = byConclusion.get(conclusion)
    if (!byDevice) {
      byDevice = new Map()
      byConclusion.set(conclusion, byDevice)
    }
    const items = byDevice.get(device) ?? []
    items.push(row)
    byDevice.set(device, items)
  }
  const boardRows = [...stations.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh'))
    .map(([station, byConclusion]) => ({
      station,
      cells: conclusions.map((conclusion) => ({
        conclusion,
        groups: [...(byConclusion.get(conclusion) ?? new Map<string, EntryRow[]>()).entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'zh'))
          .map(([device, items]) => ({
            device,
            checker:
              [...new Set(items.map((item) => String(item['核对人'] ?? '').trim()))]
                .filter(Boolean)
                .join('、') || '—',
            items: [...items].sort((a, b) =>
              String(a['核对编号'] ?? '').localeCompare(String(b['核对编号'] ?? ''), 'zh'),
            ),
          })),
      })),
    }))
  return { conclusions, rows: boardRows, totals }
}

// 判定不符之后，定值整定的待办清单跟着多出一条；同一张核对单重复提交只留一条待办。
function syncSettingTodo(checkRow: EntryRow): void {
  if (checkConclusion(checkRow) !== CHECK_MISMATCH) {
    return
  }
  const source = String(checkRow['核对编号'] ?? '').trim()
  if (source === '') {
    return
  }
  const todos = listRows('settingvalue')
  if (todos.some((row) => String(row['来源核对编号'] ?? '') === source)) {
    return
  }
  const nextId = todos.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待整定',
    pending: true,
    abnormal: false,
    '定值单号': `SETT-${String(nextId).padStart(4, '0')}`,
    '所属装置': String(checkRow['装置名称'] ?? ''),
    '定值项目': `核对不符复整（${source}）`,
    '整定值': String(checkRow['现场定值'] ?? ''),
    '计算依据': `定值核对${source}判定不符，以现场定值为准复整`,
    '整定人': '',
    '审核人': '',
    '定值状态': '待整定',
    '来源核对编号': source,
  }
  saveRows('settingvalue', [...todos, todo])
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  // 核对清单与核对单看板同口径：同一张核对单重复提交只留一条，两处核对人保持一致。
  const rows = key === 'settingcheck' ? dedupeCheckRows(listRows(key)) : listRows(key)
  for (const row of rows) {
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
