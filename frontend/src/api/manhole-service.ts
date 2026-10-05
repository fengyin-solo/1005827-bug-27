import {
  BODY_FIELD,
  CODE_FIELD,
  COVER_FIELD,
  COVER_VALUES,
  DEPTH_FIELD,
  FINISHED_STATUS,
  INSPECT_DATE_FIELD,
  INSPECTOR_FIELD,
  MANHOLE_KEY,
  MEASURE_FIELD,
  SEGMENT_FIELD,
  TIER_LABEL,
  arbitrateContenders,
  belongsTo,
  coverMessage,
  crewById,
  depthMessage,
  deriveBodyState,
  isFinished,
  segmentByCode,
  segmentNameOf,
  type AuditStage,
  type Contender,
  type CoverValue,
  type CrewInfo,
  type ManholeAuditEntry,
  type ManholeRecord,
} from '@/data/manhole-domain'
import {
  appendAudit,
  listAudit,
  listManholeRows,
  saveRows,
} from '@/data/local-store'
import { moduleMeta } from './local-service'

// 检查井服务层：登记、改动、状态流转的唯一收口。
// 新增与改动共用同一道归属闸门，避免两处校验口径对不上。

const meta = moduleMeta(MANHOLE_KEY)

export type Gate =
  | '身份'
  | '必填'
  | '归属'
  | '重号'
  | '办结受控'
  | '在档'
  | '乐观锁'
  | '井盖状况'
  | '井深'
  | '并发仲裁'
  | '动作'
  | '状态'

export type ServiceResult<T = undefined> = {
  ok: boolean
  message: string
  gate?: Gate
  data?: T
}

export type CreateInput = {
  code: string
  segmentCode: string
  cover: CoverValue | string
  depth: number
  measure?: string
  inspectDate?: string
}

export type UpdateInput = {
  id: number
  cover?: string
  depth?: number
  // 改动发起时依据的版本：与在档版本不一致说明已被别人先改过。
  expectedVersion?: number
}

function reject<T = { record: ManholeRecord }>(gate: Gate, message: string): ServiceResult<T> {
  return { ok: false, gate, message: `拦截在【${gate}】关口：${message}` }
}

function rejectBatch(gate: Gate, message: string): ServiceResult<{ record?: ManholeRecord }> {
  return reject<{ record?: ManholeRecord }>(gate, message)
}

function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function writeAudit(entry: Omit<ManholeAuditEntry, 'id'>): void {
  appendAudit(MANHOLE_KEY, entry)
}

function actorPart(crew: CrewInfo) {
  return {
    actorId: crew.id,
    actorName: crew.name,
    actorSegment: crew.segmentCode ? segmentNameOf(crew.segmentCode) : '无管段',
  }
}

function targetLabel(record: ManholeRecord): string {
  return `${segmentNameOf(record.segmentCode)} / ${String(record[CODE_FIELD])}`
}

function snapshot(rows: ManholeRecord[], id: number): ManholeRecord | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function findDuplicate(
  rows: ManholeRecord[],
  segmentCode: string,
  code: string,
  exceptId?: number,
): ManholeRecord | undefined {
  const target = code.trim()
  return rows.find(
    (row) =>
      row.segmentCode === segmentCode &&
      String(row[CODE_FIELD]).trim() === target &&
      (exceptId === undefined || Number(row.id) !== exceptId),
  )
}

function nextId(rows: ManholeRecord[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

type ApplyContext = {
  rows: ManholeRecord[]
  audits: Omit<ManholeAuditEntry, 'id'>[]
}

type ValidatedCreate = {
  kind: 'create'
  seq: number
  crew: CrewInfo
  input: CreateInput
}

type ValidatedUpdate = {
  kind: 'update'
  seq: number
  crew: CrewInfo
  input: UpdateInput
}

type ValidatedAction = {
  kind: 'action'
  seq: number
  crew: CrewInfo
  action: string
  id: number
}

type ValidatedRequest = ValidatedCreate | ValidatedUpdate | ValidatedAction

export type BatchRequest =
  | { kind: 'create'; seq: number; actorId: string; input: CreateInput }
  | { kind: 'update'; seq: number; actorId: string; input: UpdateInput }
  | { kind: 'action'; seq: number; actorId: string; action: string; id: number }

function resolveCrew(actorId: string): { crew?: CrewInfo; error?: ServiceResult<{ record?: ManholeRecord }> } {
  const crew = crewById(actorId)
  if (!crew) {
    return { error: rejectBatch('身份', '未识别的养护工身份，操作不受理') }
  }
  if (!crew.segmentCode) {
    return { crew, error: rejectBatch('身份', `${crew.name} 是值班管理员，不挂管段，仅有查看权，不能登记或改动检查井`) }
  }
  return { crew }
}

function applyCreate(ctx: ApplyContext, req: ValidatedCreate): ServiceResult<{ record: ManholeRecord }> {
  const { crew, input } = req
  const actor = actorPart(crew)
  const stage: AuditStage = '登记'
  const code = input.code.trim()
  if (!code) {
    const result = reject('必填', '井编号不能为空')
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: '（未填井编号）', result: '挡回', detail: result.message })
    return result
  }
  const segment = segmentByCode(input.segmentCode)
  if (!segment) {
    const result = reject('归属', `管段 ${input.segmentCode} 不在管段花名册内`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: code, result: '挡回', detail: result.message })
    return result
  }
  // 归属只认本管段：登记的井只能落在自己所属管段。
  if (input.segmentCode !== crew.segmentCode) {
    const result = reject(
      '归属',
      `${crew.name} 属 ${segmentNameOf(crew.segmentCode)}，不得把井登记到 ${segment.name}；登记只认本管段`,
    )
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: `${segment.name} / ${code}`, result: '挡回', detail: result.message })
    return result
  }
  // 同一管段下井编号不能重号。
  const duplicate = findDuplicate(ctx.rows, segment.code, code)
  if (duplicate) {
    const result = reject('重号', `${segment.name} 下井编号「${code}」已存在（#${duplicate.id}，${TIER_LABEL[duplicate.tier]}），重号登记挡回`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: `${segment.name} / ${code}`, result: '挡回', detail: result.message })
    return result
  }
  const coverProblem = coverMessage(input.cover)
  if (coverProblem) {
    const result = reject('井盖状况', coverProblem)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: `${segment.name} / ${code}`, result: '挡回', detail: result.message })
    return result
  }
  const depthProblem = depthMessage(Number(input.depth))
  if (depthProblem) {
    const result = reject('井深', depthProblem)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '登记检查井', stage, target: `${segment.name} / ${code}`, result: '挡回', detail: result.message })
    return result
  }
  const now = new Date().toISOString()
  const bodyState = deriveBodyState(input.cover)
  const record: ManholeRecord = {
    id: nextId(ctx.rows),
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
    [CODE_FIELD]: code,
    [SEGMENT_FIELD]: segment.name,
    segmentCode: segment.code,
    tier: 'owned',
    [COVER_FIELD]: input.cover,
    [DEPTH_FIELD]: Number(input.depth),
    [INSPECTOR_FIELD]: crew.name,
    [INSPECT_DATE_FIELD]: input.inspectDate || today(),
    [MEASURE_FIELD]: input.measure?.trim() || '—',
    [BODY_FIELD]: bodyState,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  ctx.rows.push(record)
  const message = `登记成功：${targetLabel(record)} 归属 ${segment.name}，井体状态按井盖状况核定为「${bodyState}」（v1）`
  ctx.audits.push({ ...actor, time: now, action: '登记检查井', stage, target: targetLabel(record), result: '通过', detail: message })
  return { ok: true, message, data: { record } }
}

function applyUpdate(ctx: ApplyContext, req: ValidatedUpdate): ServiceResult<{ record: ManholeRecord }> {
  const { crew, input } = req
  const actor = actorPart(crew)
  const stage: AuditStage = '改动'
  const record = snapshot(ctx.rows, input.id)
  if (!record) {
    const result = reject('在档', `没有找到编号为 ${input.id} 的检查井`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target: `#${input.id}`, result: '挡回', detail: result.message })
    return result
  }
  const target = targetLabel(record)
  // 养护办结的井整条受控、只读。
  if (isFinished(record)) {
    const result = reject('办结受控', `井「${String(record[CODE_FIELD])}」已养护办结，整条受控只读，井盖状况与井深均不得再改`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target, result: '挡回', detail: result.message })
    return result
  }
  // 只有本管段的人能改井盖状况与井深，跨管段一律退回。
  if (!belongsTo(record, crew)) {
    const result = reject(
      '归属',
      `井「${String(record[CODE_FIELD])}」属 ${segmentNameOf(record.segmentCode)}，${crew.name} 属 ${segmentNameOf(crew.segmentCode)}，跨管段改动一律退回`,
    )
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target, result: '挡回', detail: result.message })
    return result
  }
  // 并发改动：只认先到的那一版，版本对不上直接挡回。
  if (typeof input.expectedVersion === 'number' && input.expectedVersion !== record.version) {
    const result = reject(
      '乐观锁',
      `井「${String(record[CODE_FIELD])}」已被先到的提交改动过（当前 v${record.version}，你依据的是 v${input.expectedVersion}），请按最新版本重新提交`,
    )
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target, result: '挡回', detail: result.message })
    return result
  }
  const cover = input.cover === undefined ? String(record[COVER_FIELD]) : input.cover
  const depth = input.depth === undefined ? Number(record[DEPTH_FIELD]) : Number(input.depth)
  const coverProblem = coverMessage(cover)
  if (coverProblem) {
    const result = reject('井盖状况', coverProblem)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target, result: '挡回', detail: result.message })
    return result
  }
  const depthProblem = depthMessage(depth)
  if (depthProblem) {
    const result = reject('井深', depthProblem)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action: '改动井盖状况/井深', stage, target, result: '挡回', detail: result.message })
    return result
  }
  const oldCover = String(record[COVER_FIELD])
  const oldDepth = Number(record[DEPTH_FIELD])
  const oldBody = String(record[BODY_FIELD])
  const newBody = deriveBodyState(cover)
  const changed: string[] = []
  if (cover !== oldCover) {
    changed.push(`井盖状况：${oldCover} → ${cover}`)
  }
  if (depth !== oldDepth) {
    changed.push(`井深：${oldDepth} → ${depth}`)
  }
  if (changed.length === 0) {
    return { ok: true, message: `井「${String(record[CODE_FIELD])}」内容无变化，未落任何改动`, data: { record } }
  }
  const now = new Date().toISOString()
  const index = ctx.rows.findIndex((row) => Number(row.id) === record.id)
  const updated: ManholeRecord = {
    ...record,
    [COVER_FIELD]: cover,
    [DEPTH_FIELD]: depth,
    // 井体状态随井盖状况同笔原子重算：列表页与详情页读同一份，不会再出现新老值两张皮。
    [BODY_FIELD]: newBody,
    version: record.version + 1,
    updatedAt: now,
  }
  ctx.rows.splice(index, 1, updated)
  const bodyNote = newBody === oldBody ? `井体状态保持「${newBody}」` : `井体状态随同一笔提交重算：${oldBody} → ${newBody}`
  const message = `改动成功：${target}（${changed.join('；')}；${bodyNote}；v${record.version} → v${updated.version}）`
  ctx.audits.push({ ...actor, time: now, action: '改动井盖状况/井深', stage, target, result: '通过', detail: message })
  return { ok: true, message, data: { record: updated } }
}

function applyAction(ctx: ApplyContext, req: ValidatedAction): ServiceResult<{ record: ManholeRecord }> {
  const { crew, action, id } = req
  const actor = actorPart(crew)
  const stage: AuditStage = '状态流转'
  const record = snapshot(ctx.rows, id)
  if (!record) {
    const result = reject('在档', `没有找到编号为 ${id} 的检查井`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action, stage, target: `#${id}`, result: '挡回', detail: result.message })
    return result
  }
  const target = targetLabel(record)
  const targetStatus = meta.actionTargets[action]
  if (!targetStatus) {
    const result = reject('动作', `检查井没有登记「${action}」这个动作`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action, stage, target, result: '挡回', detail: result.message })
    return result
  }
  if (isFinished(record)) {
    const result = reject('办结受控', `井「${String(record[CODE_FIELD])}」已养护办结，整条受控只读，不能再执行「${action}」`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action, stage, target, result: '挡回', detail: result.message })
    return result
  }
  if (!belongsTo(record, crew)) {
    const result = reject(
      '归属',
      `井「${String(record[CODE_FIELD])}」属 ${segmentNameOf(record.segmentCode)}，${crew.name} 属 ${segmentNameOf(crew.segmentCode)}，跨管段流转一律退回`,
    )
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action, stage, target, result: '挡回', detail: result.message })
    return result
  }
  if (String(record.status) === targetStatus) {
    const result = reject('状态', `井「${String(record[CODE_FIELD])}」已经是「${targetStatus}」，不用重复操作`)
    ctx.audits.push({ ...actor, time: new Date().toISOString(), action, stage, target, result: '挡回', detail: result.message })
    return result
  }
  const now = new Date().toISOString()
  const index = ctx.rows.findIndex((row) => Number(row.id) === record.id)
  const updated: ManholeRecord = {
    ...record,
    status: targetStatus,
    pending: targetStatus === '待检查' || targetStatus === '检查中',
    abnormal: targetStatus === '需维修',
    version: record.version + 1,
    updatedAt: now,
  }
  ctx.rows.splice(index, 1, updated)
  const lockNote = targetStatus === FINISHED_STATUS ? '，该井整条受控、转为只读' : ''
  const message = `${action}成功：${target} 当前状态「${targetStatus}」${lockNote}（v${updated.version}）`
  ctx.audits.push({ ...actor, time: now, action, stage, target, result: '通过', detail: message })
  return { ok: true, message, data: { record: updated } }
}

// 并发提交：
//   - 对同一口在档井的改动/流转：按归属判定优先级（归属方先于跨管段方），同归属只认先到一版，
//     冲突的一条挡在【并发仲裁】关口并留痕；
//   - 登记类请求不参与仲裁：跨管段登记走【归属】、重号（在档或同批先登记）走【重号】。
// 通过仲裁的请求再按到达顺序依次走完整校验。
export function submitManholeBatch(requests: BatchRequest[]): ServiceResult<{ record?: ManholeRecord }>[] {
  const validated: { req: ValidatedRequest; responseIndex: number }[] = []
  const responses: ServiceResult<{ record?: ManholeRecord }>[] = requests.map(() => ({ ok: false, message: '' }))

  // 先解析身份并确定每笔请求撞车用的分组键（管段 + 井编号）。
  const contenders: (Contender & { responseIndex: number })[] = []
  requests.forEach((request, responseIndex) => {
    const { crew, error } = resolveCrew(request.actorId)
    if (!crew || error) {
      if (error) {
        responses[responseIndex] = error
      }
      return
    }
    if (request.kind === 'create') {
      const code = request.input.code.trim()
      if (!code || !segmentByCode(request.input.segmentCode)) {
        // 基本形态不合法的请求不参与撞车分组，留给执行阶段判。
        validated.push({
          req: { kind: 'create', seq: request.seq, crew, input: request.input },
          responseIndex,
        })
        return
      }
      validated.push({
        req: { kind: 'create', seq: request.seq, crew, input: request.input },
        responseIndex,
      })
      // 登记类请求不进并发仲裁组：重号（无论在档还是同批先登记）一律走【重号】关口，
      // 保证同一种失败只有一个明确的拦截关口。仲裁只管对同一口在档井的改动/流转争抢。
    } else {
      const record = listManholeRows().find((row) => Number(row.id) === (request.kind === 'update' ? request.input.id : request.id))
      validated.push({
        req:
          request.kind === 'update'
            ? { kind: 'update', seq: request.seq, crew, input: request.input }
            : { kind: 'action', seq: request.seq, crew, action: request.action, id: request.id },
        responseIndex,
      })
      if (record) {
        contenders.push({
          seq: request.seq,
          actorId: crew.id,
          actorName: crew.name,
          actorSegment: crew.segmentCode ? segmentNameOf(crew.segmentCode) : '无管段',
          own: belongsTo(record, crew),
          groupKey: `${record.segmentCode}|${String(record[CODE_FIELD]).trim()}`,
          targetLabel: targetLabel(record),
          responseIndex,
        })
      }
    }
  })

  // 仲裁：归属方优先，同归属先到先得；败者直接挡回并留痕。
  const verdicts = arbitrateContenders(contenders)
  const loserIndexes = new Set<number>()
  for (const verdict of verdicts) {
    const loser = contenders.find((item) => item.seq === verdict.loserSeq)
    const winner = contenders.find((item) => item.seq === verdict.winnerSeq)
    if (!loser) {
      continue
    }
    const result = rejectBatch('并发仲裁', verdict.message)
    responses[loser.responseIndex] = result
    loserIndexes.add(loser.responseIndex)
    writeAudit({
      actorId: loser.actorId,
      actorName: loser.actorName,
      actorSegment: loser.actorSegment,
      time: new Date().toISOString(),
      action: '并发改动检查井',
      stage: '并发仲裁',
      target: loser.targetLabel,
      result: '挡回',
      detail: `${result.message}（冲突胜方：${winner?.actorName ?? '未知'}，想动的井：${loser.targetLabel}）`,
    })
  }

  const ctx: ApplyContext = { rows: [...listManholeRows()], audits: [] }
  for (const { req, responseIndex } of validated.sort((a, b) => a.req.seq - b.req.seq)) {
    if (loserIndexes.has(responseIndex)) {
      continue
    }
    if (req.kind === 'create') {
      responses[responseIndex] = applyCreate(ctx, req)
    } else if (req.kind === 'update') {
      responses[responseIndex] = applyUpdate(ctx, req)
    } else {
      responses[responseIndex] = applyAction(ctx, req)
    }
  }
  for (const entry of ctx.audits) {
    writeAudit(entry)
  }
  if (responses.some((result) => result.ok)) {
    saveRows(MANHOLE_KEY, ctx.rows)
  }
  return responses
}

export function createManhole(actorId: string, input: CreateInput): ServiceResult<{ record: ManholeRecord }> {
  const [result] = submitManholeBatch([{ kind: 'create', seq: 0, actorId, input }])
  return result as ServiceResult<{ record: ManholeRecord }>
}

export function updateManhole(actorId: string, input: UpdateInput): ServiceResult<{ record: ManholeRecord }> {
  const [result] = submitManholeBatch([{ kind: 'update', seq: 0, actorId, input }])
  return result as ServiceResult<{ record: ManholeRecord }>
}

export function runManholeAction(actorId: string, id: number, action: string): ServiceResult<{ record: ManholeRecord }> {
  const [result] = submitManholeBatch([{ kind: 'action', seq: 0, actorId, id, action }])
  return result as ServiceResult<{ record: ManholeRecord }>
}

export type ManholeListFilters = {
  keyword?: string
  segmentCode?: string
  status?: string
  bodyState?: string
}

export function listManholes(filters: ManholeListFilters = {}): { items: ManholeRecord[]; total: number } {
  let items = [...listManholeRows()]
  const keyword = filters.keyword?.trim()
  if (keyword) {
    items = items.filter(
      (row) =>
        String(row[CODE_FIELD]).includes(keyword) ||
        String(row[INSPECTOR_FIELD]).includes(keyword),
    )
  }
  if (filters.segmentCode) {
    items = items.filter((row) => row.segmentCode === filters.segmentCode)
  }
  if (filters.status) {
    items = items.filter((row) => String(row.status) === filters.status)
  }
  if (filters.bodyState) {
    items = items.filter((row) => String(row[BODY_FIELD]) === filters.bodyState)
  }
  return { items, total: items.length }
}

export function getManhole(id: number): ManholeRecord | undefined {
  return listManholeRows().find((row) => Number(row.id) === id)
}

export type ManholeStat = { label: string; value: number }

export function manholeStats(): ManholeStat[] {
  const rows = listManholeRows()
  return [
    { label: '在档检查井', value: rows.length },
    { label: '待检查', value: rows.filter((row) => String(row.status) === '待检查').length },
    { label: '检查中', value: rows.filter((row) => String(row.status) === '检查中').length },
    { label: '已养护受控', value: rows.filter((row) => String(row.status) === FINISHED_STATUS).length },
    { label: '需维修', value: rows.filter((row) => String(row.status) === '需维修').length },
    { label: '井口危险', value: rows.filter((row) => String(row[BODY_FIELD]) === '井口危险').length },
  ]
}

export function listManholeAudits(keyword = ''): ManholeAuditEntry[] {
  const rows = listAudit(MANHOLE_KEY)
  const word = keyword.trim()
  if (!word) {
    return rows
  }
  return rows.filter(
    (row) =>
      row.actorName.includes(word) ||
      row.target.includes(word) ||
      row.detail.includes(word) ||
      row.action.includes(word),
  )
}

export { COVER_VALUES }
