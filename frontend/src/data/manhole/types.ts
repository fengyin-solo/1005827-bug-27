import type { ActionResult, EntryRow } from '@/data/types'

/** 检查井养护责任域：归属只认管段，校验规则登记与改动共用同一套。 */

export const MANHOLE_KEY = 'manhole'

/** 只有这两列允许由本管段养护工改动；井编号与归属不由此通道修改。 */
export const FIELDS_OWNER_EDITABLE = ['井盖状况', '井深'] as const

export const COVER_STATUS = ['完好', '破损', '沉降', '缺失'] as const
export type CoverStatus = (typeof COVER_STATUS)[number]

/** 井体状态口径：由井盖状况派生，不接受手工填写，列表与详情同源，不会再出现两处对不上。 */
const BODY_BY_COVER: Record<CoverStatus, string> = {
  完好: '正常',
  破损: '井体损伤',
  沉降: '需关注',
  缺失: '井体险情',
}

/** 养护办结：进入该状态的井整条受控，任何改动与流转一律只读。 */
export const LOCKED_STATUS = '已养护'

/** 留痕记录的环节标记：被哪一道守卫拦下一眼可查。 */
export const GATES = ['参数校验', '归属校验', '办结锁定', '重号校验', '并发冲突', '权限校验'] as const
export type Gate = (typeof GATES)[number]

export type Actor = {
  /** 值班管理员用 admin；养护工用花名册里的姓名。 */
  name: string
  admin: boolean
  /** 该养护工负责的管段；跨管段提交一律退回。 */
  segments: string[]
}

export type SegmentInfo = {
  code: string
  name: string
  /** 老档管段：既有井档按原层级保留，仍配责任人以兼容既有责任。 */
  legacy: boolean
  caretaker: string
}

export type ManholeView = {
  raw: EntryRow
  id: number
  code: string
  segment: string
  cover: string
  depth: string
  inspector: string
  inspectDate: string
  measure: string
  /** 展示用井体状态：按井盖状况现算，读不到时回退到档内原值。 */
  body: string
  status: string
  version: number
  locked: boolean
  ownerCaretaker: string
  legacySegment: boolean
}

export type ManholePatch = {
  cover?: string
  depth?: string
  /** 页面打开详情时读到的版本号：与存储里的版本不一致说明已被别人先改。 */
  expectedVersion: number
}

export type AuditEntry = {
  id: number
  at: string
  actor: string
  action: string
  manholeId: number | null
  manholeCode: string
  segment: string
  ok: boolean
  /** 拦在哪个环节；通过的记「校验通过」。 */
  gate: Gate | '校验通过'
  detail: string
  fromVersion: number | null
  toVersion: number | null
}

export type ManholeServiceResult = ActionResult & {
  /** 冲突/退回时带上存储里的最新版本，供页面回显先到那一版。 */
  current?: ManholeView
}

export function deriveBody(cover: string, fallback = '井体待核定'): string {
  return BODY_BY_COVER[cover as CoverStatus] ?? fallback
}

export function isLockedStatus(status: string): boolean {
  return status === LOCKED_STATUS
}
