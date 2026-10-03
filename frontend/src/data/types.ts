/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 定值核对看板：按所属变电站分行、核对结论分栏，栏内按装置名称归集。
export type SettingcheckBoardGroup = {
  device: string
  checker: string
  items: EntryRow[]
}

export type SettingcheckBoardCell = {
  conclusion: string
  groups: SettingcheckBoardGroup[]
}

export type SettingcheckBoardRow = {
  station: string
  cells: SettingcheckBoardCell[]
}

export type SettingcheckBoard = {
  conclusions: string[]
  rows: SettingcheckBoardRow[]
  totals: Record<string, number>
}
