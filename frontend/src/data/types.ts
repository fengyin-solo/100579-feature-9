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

/** 定值核对：现场实测与台账定值比对出的条目结论。 */
export type CheckItemVerdict = 'mismatch' | 'pending' | 'match'

/** 定值核对：一张核对单对应一个变电站内的一台装置。 */
export type CheckConclusion = '核对不符' | '待出结论' | '核对一致'

export type CheckSheet = {
  /** 核对单唯一键：所属变电站 + 装置名称。 */
  key: string
  station: string
  device: string
  /** 该装置下的全部核对条目，不符在前、待实测居中、一致在末。 */
  items: EntryRow[]
  mismatchItems: EntryRow[]
  pendingItems: EntryRow[]
  matchItems: EntryRow[]
  conclusion: CheckConclusion
  signed: boolean
  signer: string
  signedAt: string
}

export type CheckBoardColumn = {
  conclusion: CheckConclusion
  title: string
  sheets: CheckSheet[]
}

export type CheckBoardStation = {
  station: string
  columns: Record<CheckConclusion, CheckSheet[]>
}

export type CheckBoard = {
  columns: { conclusion: CheckConclusion; title: string }[]
  stations: CheckBoardStation[]
  sheets: CheckSheet[]
}
