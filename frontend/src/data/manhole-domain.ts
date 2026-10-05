import type { EntryRow } from './types'

// 检查井责任域：管段花名册、养护工花名册、归属/重号/办结受控/井体状态推导/并发仲裁都集中在这里。
// 新增与改动走同一套纯函数校验，页面与服务层不再各写一份业务判断，避免「新增拦了、改动漏了」的对不上。

export const MANHOLE_KEY = 'manhole'

export const CODE_FIELD = '井编号'
export const SEGMENT_FIELD = '所属管段'
export const COVER_FIELD = '井盖状况'
export const DEPTH_FIELD = '井深'
export const BODY_FIELD = '井体状态'
export const INSPECTOR_FIELD = '检查人'
export const INSPECT_DATE_FIELD = '检查日期'
export const MEASURE_FIELD = '养护措施'

export const COVER_VALUES = ['完好', '破损', '缺失'] as const
export type CoverValue = (typeof COVER_VALUES)[number]

// 井体状态只由井盖状况推导：井盖改动后随同一笔提交原子重算，列表页与详情页读同一份数据。
export const BODY_STATE_BY_COVER: Record<CoverValue, string> = {
  完好: '井况正常',
  破损: '井体破损',
  缺失: '井口危险',
}

// 养护办结：整条记录受控、只读，任何改动与流转都在此被挡下。
export const FINISHED_STATUS = '已养护'

export const DEPTH_MIN = 0.2
export const DEPTH_MAX = 30

export type SegmentInfo = {
  code: string
  name: string
  // 既有井档里沿用的旧层级叫法：只用于归属认亲，不改写既有档原值。
  aliases: string[]
}

// 管段花名册与排水管网（drainpipe）的管段编号对齐。
export const MANHOLE_SEGMENTS: SegmentInfo[] = [
  { code: 'DRAI-0001', name: '迎宾大道管段', aliases: ['检查井维护样例1', '迎宾大道', 'DRAI-0001'] },
  { code: 'DRAI-0002', name: '滨河路管段', aliases: ['检查井维护样例2', '滨河路', 'DRAI-0002'] },
  { code: 'DRAI-0003', name: '工业园管段', aliases: ['检查井维护样例3', '工业园', 'DRAI-0003'] },
]

export type CrewInfo = {
  id: string
  name: string
  segmentCode: string
  title: string
}

// 养护工花名册：同管段可有多口井、多名养护工；值班管理员不挂管段，只有查看权。
export const MANHOLE_CREW: CrewInfo[] = [
  { id: 'u01', name: '王养护', segmentCode: 'DRAI-0001', title: '迎宾大道管段养护工' },
  { id: 'u02', name: '陈养护', segmentCode: 'DRAI-0001', title: '迎宾大道管段养护工' },
  { id: 'u03', name: '李排水', segmentCode: 'DRAI-0002', title: '滨河路管段养护工' },
  { id: 'u04', name: '周巡检', segmentCode: 'DRAI-0003', title: '工业园管段养护工' },
  { id: 'admin', name: '赵值班', segmentCode: '', title: '值班管理员（无管段，全局只读）' },
]

export type ArchiveTier = 'legacy' | 'owned'
export const TIER_LABEL: Record<ArchiveTier, string> = {
  legacy: '既有档',
  owned: '责任档',
}

export type ManholeRecord = EntryRow & {
  [CODE_FIELD]: string
  [SEGMENT_FIELD]: string
  原所属管段?: string
  segmentCode: string
  tier: ArchiveTier
  [COVER_FIELD]: string
  [DEPTH_FIELD]: number
  [INSPECTOR_FIELD]: string
  [INSPECT_DATE_FIELD]: string
  [MEASURE_FIELD]: string
  [BODY_FIELD]: string
  原井体状态?: string
  // 乐观锁版本：同一口井并发改动时，只认先到的那一版。
  version: number
  createdAt: string
  updatedAt: string
}

export function crewById(id: string): CrewInfo | undefined {
  return MANHOLE_CREW.find((item) => item.id === id)
}

export function segmentByCode(code: string): SegmentInfo | undefined {
  return MANHOLE_SEGMENTS.find((item) => item.code === code)
}

export function segmentNameOf(code: string): string {
  return segmentByCode(code)?.name ?? '未认领管段'
}

// 按编号、规范名或旧层级别名认管段；认不到返回 undefined（既有档保留原值、挂空归属）。
export function resolveSegment(value: string): SegmentInfo | undefined {
  const text = value.trim()
  if (!text) {
    return undefined
  }
  return MANHOLE_SEGMENTS.find(
    (item) => item.code === text || item.name === text || item.aliases.includes(text),
  )
}

export function deriveBodyState(cover: string): string {
  return BODY_STATE_BY_COVER[cover as CoverValue] ?? '井况待评'
}

export function isFinished(record: ManholeRecord): boolean {
  return String(record.status) === FINISHED_STATUS
}

// 归属只认井所属的管段：本管段的人才算归属方。
export function belongsTo(record: ManholeRecord, crew: CrewInfo): boolean {
  return Boolean(crew.segmentCode) && record.segmentCode === crew.segmentCode
}

export function depthMessage(raw: number): string {
  if (!Number.isFinite(raw)) {
    return '井深必须是数字'
  }
  if (raw < DEPTH_MIN) {
    return `井深不能小于 ${DEPTH_MIN} 米`
  }
  if (raw > DEPTH_MAX) {
    return `井深不能大于 ${DEPTH_MAX} 米`
  }
  return ''
}

export function coverMessage(cover: string): string {
  return (COVER_VALUES as readonly string[]).includes(cover) ? '' : '井盖状况只能是 完好 / 破损 / 缺失'
}

export type MigrationNote = {
  id: number
  code: string
  segmentName: string
  oldSegment: string
  oldBody: string
  newBody: string
  tier: ArchiveTier
}

export type MigrationResult = {
  rows: ManholeRecord[]
  notes: MigrationNote[]
}

// 审计留痕：谁、什么时候、想动哪口井、拦在哪个关口、结果如何，都能倒查。
export type AuditStage =
  | '登记'
  | '改动'
  | '状态流转'
  | '迁移重算'
  | '并发仲裁'

export type AuditResult = '通过' | '挡回'

export type ManholeAuditEntry = {
  id: number
  time: string
  actorId: string
  actorName: string
  actorSegment: string
  action: string
  stage: AuditStage
  target: string
  result: AuditResult
  detail: string
}

// 一次性迁移：补齐责任域字段，既有井档原层级值原样保留（原所属管段/原井体状态），
// 井体状态按新的归属口径重算一次。幂等：已具备责任域结构的行不再处理。
export function migrateManholeRows(rawRows: EntryRow[], now: string): MigrationResult {
  const notes: MigrationNote[] = []
  const rows = rawRows.map((raw) => {
    if (typeof raw.version === 'number' && typeof raw.segmentCode === 'string') {
      return raw as ManholeRecord
    }
    const oldSegment = String(raw[SEGMENT_FIELD] ?? '').trim()
    const segment = resolveSegment(oldSegment)
    const cover = String(raw[COVER_FIELD] ?? '').trim() || '完好'
    const oldBody = String(raw[BODY_FIELD] ?? '').trim()
    const newBody = deriveBodyState(cover)
    const rawDepth = Number(raw[DEPTH_FIELD])
    const record: ManholeRecord = {
      ...raw,
      [CODE_FIELD]: String(raw[CODE_FIELD] ?? `MANH-LEGACY-${raw.id}`),
      [SEGMENT_FIELD]: segment ? segment.name : oldSegment,
      ...(segment && segment.name !== oldSegment ? { 原所属管段: oldSegment } : {}),
      segmentCode: segment?.code ?? '',
      tier: 'legacy',
      [COVER_FIELD]: cover,
      [DEPTH_FIELD]: Number.isFinite(rawDepth) ? rawDepth : 0,
      [INSPECTOR_FIELD]: String(raw[INSPECTOR_FIELD] ?? '未登记'),
      [INSPECT_DATE_FIELD]: String(raw[INSPECT_DATE_FIELD] ?? ''),
      [MEASURE_FIELD]: String(raw[MEASURE_FIELD] ?? '—'),
      [BODY_FIELD]: newBody,
      ...(oldBody && oldBody !== newBody ? { 原井体状态: oldBody } : {}),
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    notes.push({
      id: record.id,
      code: String(record[CODE_FIELD] ?? record.id),
      segmentName: segment ? segment.name : oldSegment || '未认领管段',
      oldSegment,
      oldBody: oldBody || '（空）',
      newBody,
      tier: 'legacy',
    })
    return record
  })
  return { rows, notes }
}

// 并发仲裁：同一口井（同管段 + 同井编号）上的多笔提交先分组。
// 组内优先级：归属方先于跨管段方；同为归属方时按到达顺序，只认先到的一版。
export type Contender = {
  seq: number
  actorId: string
  actorName: string
  actorSegment: string
  own: boolean
  groupKey: string
  targetLabel: string
}

export type ConflictVerdict = {
  loserSeq: number
  winnerSeq: number
  winnerName: string
  reason: 'ownership' | 'arrival'
  message: string
}

export function arbitrateContenders(contenders: Contender[]): ConflictVerdict[] {
  const groups = new Map<string, Contender[]>()
  for (const item of contenders) {
    const list = groups.get(item.groupKey) ?? []
    list.push(item)
    groups.set(item.groupKey, list)
  }
  const verdicts: ConflictVerdict[] = []
  for (const list of groups.values()) {
    if (list.length < 2) {
      continue
    }
    const ranked = [...list].sort((a, b) => {
      if (a.own !== b.own) {
        return a.own ? -1 : 1
      }
      return a.seq - b.seq
    })
    const winner = ranked[0]
    for (const loser of ranked.slice(1)) {
      const reason: ConflictVerdict['reason'] = loser.own ? 'arrival' : 'ownership'
      const message =
        reason === 'ownership'
          ? `与第 ${winner.seq + 1} 笔提交（${winner.actorName}）撞车：按管段归属判定，归属方 ${winner.actorName} 优先，本笔挡回`
          : `同一口井并发改动只认先到的一版：第 ${winner.seq + 1} 笔（${winner.actorName}）先到，本笔挡回`
      verdicts.push({ loserSeq: loser.seq, winnerSeq: winner.seq, winnerName: winner.actorName, reason, message })
    }
  }
  return verdicts
}
