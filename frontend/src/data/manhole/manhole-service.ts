import { MODULE_BY_KEY } from '@/data/modules'
import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { appendAudit, listAudit } from './audit-store'
import { ownsSegment, segmentInfo } from './segments'
import {
  COVER_STATUS,
  deriveBody,
  isLockedStatus,
  LOCKED_STATUS,
  MANHOLE_KEY,
  type Actor,
  type AuditEntry,
  type Gate,
  type ManholePatch,
  type ManholeServiceResult,
  type ManholeView,
} from './types'

// 检查井服务：登记与改动共用同一套归属口径，页面不做业务判断，只负责渲染与提交。

type RegisterInput = {
  segment: string
  code: string
  cover: string
  depth: string
  inspector: string
  inspectDate: string
  measure: string
}

function fail(
  message: string,
  gate: Gate,
  trace: {
    actor: Actor
    action: string
    manholeId: number | null
    manholeCode: string
    segment: string
    fromVersion?: number | null
    toVersion?: number | null
    detail?: string
  },
  current?: ManholeView,
): ManholeServiceResult {
  appendAudit({
    actor: trace.actor.name,
    action: trace.action,
    manholeId: trace.manholeId,
    manholeCode: trace.manholeCode,
    segment: trace.segment,
    ok: false,
    gate,
    detail: trace.detail ?? message,
    fromVersion: trace.fromVersion ?? null,
    toVersion: trace.toVersion ?? null,
  })
  return { ok: false, message: `【${gate}】${message}`, ...(current ? { current } : {}) }
}

function pass(
  message: string,
  trace: Omit<AuditEntry, 'id' | 'at' | 'ok' | 'gate'>,
): ManholeServiceResult {
  appendAudit({ ...trace, ok: true, gate: '校验通过' })
  return { ok: true, message }
}

export function present(row: EntryRow): ManholeView {
  const segment = String(row['所属管段'] ?? '')
  const cover = String(row['井盖状况'] ?? '')
  const storedBody = row['井体状态'] !== undefined ? String(row['井体状态']) : ''
  const info = segmentInfo(segment)
  return {
    raw: row,
    id: Number(row.id),
    code: String(row['井编号'] ?? ''),
    segment,
    cover,
    depth: String(row['井深'] ?? ''),
    inspector: String(row['检查人'] ?? ''),
    inspectDate: String(row['检查日期'] ?? ''),
    measure: String(row['养护措施'] ?? ''),
    // 井盖状况认得就按口径现算；认不得（老档原始值）则回退档内原值，老档不被改写。
    body: deriveBody(cover, storedBody || '井体待核定'),
    status: String(row.status ?? ''),
    version: Number(row.version) || 1,
    locked: isLockedStatus(String(row.status)),
    ownerCaretaker: info.caretaker,
    legacySegment: info.legacy,
  }
}

export function listManholes(filters: Record<string, string> = {}): {
  items: ManholeView[]
  total: number
} {
  const matched = filterRows(listRows(MANHOLE_KEY), filters)
  const items = matched
    .map((row) => present(row))
    // 详情/列表共用字段映射，井深等列直接取自这里，杜绝两页显示成两个值。
    .sort((a, b) => a.id - b.id)
  return { items, total: items.length }
}

export function getManhole(id: number): ManholeView | null {
  const row = listRows(MANHOLE_KEY).find((item) => Number(item.id) === id)
  return row ? present(row) : null
}

function validDepth(value: string): boolean {
  const text = value.trim().replace(/米$/, '')
  const num = Number(text)
  return value.trim() !== '' && Number.isFinite(num) && num > 0
}

/** 登记检查井：新增时也要过归属、重号两道关，不能再只挡老路径。 */
export function registerManhole(actor: Actor, input: RegisterInput): ManholeServiceResult {
  const code = input.code.trim()
  const segment = input.segment.trim()
  const cover = input.cover.trim()
  const depth = input.depth.trim()

  if (!code || !segment) {
    return fail('井编号与所属管段不能为空，登记已退回', '参数校验', {
      actor,
      action: '登记检查井',
      manholeId: null,
      manholeCode: code,
      segment,
    })
  }
  if (!COVER_STATUS.includes(cover as (typeof COVER_STATUS)[number])) {
    return fail(`井盖状况只接受 ${COVER_STATUS.join('、')}，登记已退回`, '参数校验', {
      actor,
      action: '登记检查井',
      manholeId: null,
      manholeCode: code,
      segment,
    })
  }
  if (!validDepth(depth)) {
    return fail('井深必须为大于 0 的数值（可带「米」），登记已退回', '参数校验', {
      actor,
      action: '登记检查井',
      manholeId: null,
      manholeCode: code,
      segment,
    })
  }
  if (!ownsSegment(actor, segment)) {
    return fail(
      actor.admin
        ? `登记井档是本管段养护工的责任，管理员不代为登记，请切换为管段「${segment}」责任人身份`
        : `井归属管段「${segment}」，你只负责管段 ${actor.segments.join('、') || '（无）'}，跨管段登记一律退回`,
      '归属校验',
      {
        actor,
        action: '登记检查井',
        manholeId: null,
        manholeCode: code,
        segment,
        detail: actor.admin
          ? `管理员登记被归属校验拦回：登记是本管段养护责任`
          : `跨管段登记被归属校验拦回：提交管段 ${segment}，责任管段 ${actor.segments.join('、') || '无'}`,
      },
    )
  }
  if (segmentInfo(segment).caretaker === '未指派') {
    return fail(`管段「${segment}」未在管段目录入册、没有责任人，登记已退回`, '归属校验', {
      actor,
      action: '登记检查井',
      manholeId: null,
      manholeCode: code,
      segment,
    })
  }

  const rows = listRows(MANHOLE_KEY)
  // 同一管段下井编号不能重号：重号的登记挡回。
  const duplicated = rows.find(
    (row) => String(row['所属管段']) === segment && String(row['井编号']) === code,
  )
  if (duplicated) {
    return fail(
      `管段「${segment}」下井编号「${code}」已存在（#${duplicated.id}），重号登记挡回`,
      '重号校验',
      {
        actor,
        action: '登记检查井',
        manholeId: Number(duplicated.id),
        manholeCode: code,
        segment,
      },
    )
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const body = deriveBody(cover)
  const row: ManholeView['raw'] = {
    id: nextId,
    status: '待检查',
    pending: true,
    abnormal: false,
    井编号: code,
    所属管段: segment,
    井盖状况: cover,
    井深: depth,
    检查人: input.inspector.trim() || actor.name,
    检查日期: input.inspectDate.trim() || new Date().toISOString().slice(0, 10),
    养护措施: input.measure.trim(),
    井体状态: body,
    version: 1,
  }
  saveRows(MANHOLE_KEY, [...rows, row])
  return pass(`检查井「${code}」已登记到管段「${segment}」，井体状态核定为「${body}」`, {
    actor: actor.name,
    action: '登记检查井',
    manholeId: nextId,
    manholeCode: code,
    segment,
    detail: `新登记：井盖状况 ${cover}，井深 ${depth}，井体状态 ${body}`,
    fromVersion: null,
    toVersion: 1,
  })
}

/** 改动井盖状况与井深：与登记同一套归属口径，再加办结锁定与并发版本两道关。 */
export function updateManhole(
  actor: Actor,
  id: number,
  patch: ManholePatch,
): ManholeServiceResult {
  const rows = listRows(MANHOLE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的检查井，改动已退回`, '参数校验', {
      actor,
      action: '养护改动',
      manholeId: id,
      manholeCode: '',
      segment: '',
    })
  }
  const current = present(rows[index])

  // 归属只认井所属的管段：只有本管段养护工能改井盖状况与井深，管理员也不走此通道。
  if (!ownsSegment(actor, current.segment)) {
    return fail(
      actor.admin
        ? `井「${current.code}」归属管段「${current.segment}」，管理员只能调整归属，不能替本管段改井盖状况与井深`
        : `井「${current.code}」归属管段「${current.segment}」（责任人 ${current.ownerCaretaker}），你只负责 ${actor.segments.join('、') || '（无）'}，跨管段改动一律退回`,
      '归属校验',
      {
        actor,
        action: '养护改动',
        manholeId: current.id,
        manholeCode: current.code,
        segment: current.segment,
        fromVersion: current.version,
        detail: actor.admin
          ? `管理员越权改受控字段被归属校验拦回：井属管段 ${current.segment}`
          : `跨管段改动被归属校验拦回：井属管段 ${current.segment}，提交人责任管段 ${actor.segments.join('、') || '无'}`,
      },
      current,
    )
  }

  // 养护办结的井整条受控、只读。
  if (current.locked) {
    return fail(
      `井「${current.code}」已养护办结，整条记录受控只读，不再接受改动`,
      '办结锁定',
      {
        actor,
        action: '养护改动',
        manholeId: current.id,
        manholeCode: current.code,
        segment: current.segment,
        fromVersion: current.version,
      },
      current,
    )
  }

  const cover = patch.cover?.trim() ?? current.cover
  const depth = patch.depth?.trim() ?? current.depth
  if (!COVER_STATUS.includes(cover as (typeof COVER_STATUS)[number])) {
    return fail(`井盖状况只接受 ${COVER_STATUS.join('、')}，改动已退回`, '参数校验', {
      actor,
      action: '养护改动',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }
  if (!validDepth(depth)) {
    return fail('井深必须为大于 0 的数值（可带「米」），改动已退回', '参数校验', {
      actor,
      action: '养护改动',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }

  // 并发改动：只认先到的那一版；拿旧版本提交的后到者挡住并留痕。
  if (Number(patch.expectedVersion) !== current.version) {
    return fail(
      `井「${current.code}」已被 ${current.inspector || '其他养护工'} 先改动到 v${current.version}，你拿的是 v${patch.expectedVersion}，本次并发改动只认先到版本`,
      '并发冲突',
      {
        actor,
        action: '养护改动',
        manholeId: current.id,
        manholeCode: current.code,
        segment: current.segment,
        fromVersion: patch.expectedVersion,
        toVersion: current.version,
        detail: `乐观锁冲突：提交基准 v${patch.expectedVersion}，存储现行 v${current.version}`,
      },
      current,
    )
  }

  const changed: string[] = []
  if (cover !== current.cover) changed.push(`井盖状况 ${current.cover}→${cover}`)
  if (depth !== current.depth) changed.push(`井深 ${current.depth}→${depth}`)
  if (changed.length === 0) {
    return fail('井盖状况与井深均无变化，无需提交', '参数校验', {
      actor,
      action: '养护改动',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }

  // 井体状态跟着井盖状况走：由服务统一重算，列表与详情取同一个来源。
  const body = deriveBody(cover)
  const nextVersion = current.version + 1
  const updated: ManholeView['raw'] = {
    ...current.raw,
    井盖状况: cover,
    井深: depth,
    井体状态: body,
    version: nextVersion,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MANHOLE_KEY, next)

  return pass(
    `井「${current.code}」已按本管段责任更新（${changed.join('，')}），井体状态核定为「${body}」，版本 v${current.version}→v${nextVersion}`,
    {
      actor: actor.name,
      action: '养护改动',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      detail: `本管段养护改动：${changed.join('；')}；井体状态重算为 ${body}`,
      fromVersion: current.version,
      toVersion: nextVersion,
    },
  )
}

/** 状态流转同样受归属、办结、并发版本约束；办结后进入只读。 */
export function runManholeAction(
  actor: Actor,
  id: number,
  action: string,
  expectedVersion: number,
): ManholeServiceResult {
  const meta = MODULE_BY_KEY.get(MANHOLE_KEY)!
  const target = meta.actionTargets[action]
  if (!target) {
    return fail(`检查井没有登记「${action}」这个动作`, '参数校验', {
      actor,
      action,
      manholeId: id,
      manholeCode: '',
      segment: '',
    })
  }
  const rows = listRows(MANHOLE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的检查井，${action}已退回`, '参数校验', {
      actor,
      action,
      manholeId: id,
      manholeCode: '',
      segment: '',
    })
  }
  const current = present(rows[index])

  // 养护流转同样是本管段责任，管理员不代办。
  if (!ownsSegment(actor, current.segment)) {
    return fail(
      actor.admin
        ? `井「${current.code}」归属管段「${current.segment}」，管理员不代行本管段养护流转，已退回`
        : `井「${current.code}」归属管段「${current.segment}」，跨管段不能操作其养护流转，已退回`,
      '归属校验',
      {
        actor,
        action,
        manholeId: current.id,
        manholeCode: current.code,
        segment: current.segment,
        fromVersion: current.version,
      },
      current,
    )
  }
  if (current.locked) {
    return fail(`井「${current.code}」已养护办结，整条记录受控只读，不能再执行「${action}」`, '办结锁定', {
      actor,
      action,
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    }, current)
  }
  if (current.status === target) {
    return fail(`井「${current.code}」已经是「${target}」，不用重复操作`, '参数校验', {
      actor,
      action,
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }
  if (Number(expectedVersion) !== current.version) {
    return fail(
      `井「${current.code}」已被先到的提交改到 v${current.version}（你持 v${expectedVersion}），本次${action}按并发冲突挡回，只认先到版本`,
      '并发冲突',
      {
        actor,
        action,
        manholeId: current.id,
        manholeCode: current.code,
        segment: current.segment,
        fromVersion: expectedVersion,
        toVersion: current.version,
      },
      current,
    )
  }

  const nextVersion = current.version + 1
  const updated: ManholeView['raw'] = {
    ...current.raw,
    status: target,
    pending: target !== LOCKED_STATUS,
    abnormal: target === '需维修',
    // 状态变更不改井盖，但井体状态仍按当前井盖状况对齐一次，保证口径一致。
    井体状态: deriveBody(current.cover, current.body),
    version: nextVersion,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MANHOLE_KEY, next)

  return pass(`井「${current.code}」已${action}，当前状态「${target}」，版本 v${current.version}→v${nextVersion}`, {
    actor: actor.name,
    action,
    manholeId: current.id,
    manholeCode: current.code,
    segment: current.segment,
    detail: `状态流转 ${current.status}→${target}${target === LOCKED_STATUS ? '，办结后整条受控只读' : ''}`,
    fromVersion: current.version,
    toVersion: nextVersion,
  })
}

/**
 * 归属调整：仅值班管理员可用。调整后按新的归属把该管段所有井的井体状态重算一次，
 * 办结井跳过、保持只读。
 */
export function reassignSegment(
  actor: Actor,
  id: number,
  newSegment: string,
): ManholeServiceResult {
  const rows = listRows(MANHOLE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的检查井，归属调整已退回`, '参数校验', {
      actor,
      action: '归属调整',
      manholeId: id,
      manholeCode: '',
      segment: '',
    })
  }
  const current = present(rows[index])

  if (!actor.admin) {
    return fail('归属调整只对值班管理员开放，养护工不得跨管段认领井档，已退回', '权限校验', {
      actor,
      action: '归属调整',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }
  if (current.locked) {
    return fail(`井「${current.code}」已养护办结，整条受控只读，归属也不能再调整`, '办结锁定', {
      actor,
      action: '归属调整',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }
  const targetInfo = segmentInfo(newSegment.trim())
  if (!newSegment.trim() || targetInfo.caretaker === '未指派') {
    return fail(`目标管段「${newSegment}」未入册或无责任人，归属调整已退回`, '参数校验', {
      actor,
      action: '归属调整',
      manholeId: current.id,
      manholeCode: current.code,
      segment: newSegment,
      fromVersion: current.version,
    })
  }
  if (targetInfo.code === current.segment) {
    return fail(`井「${current.code}」本就属于管段「${current.segment}」，无需调整`, '参数校验', {
      actor,
      action: '归属调整',
      manholeId: current.id,
      manholeCode: current.code,
      segment: current.segment,
      fromVersion: current.version,
    })
  }

  const nextVersion = current.version + 1
  const moved: ManholeView['raw'] = {
    ...current.raw,
    所属管段: targetInfo.code,
    version: nextVersion,
  }
  let nextRows = [...rows]
  nextRows[index] = moved
  saveRows(MANHOLE_KEY, nextRows)

  pass(
    `井「${current.code}」归属已由「${current.segment}」调整到「${targetInfo.code}」（责任人 ${targetInfo.caretaker}），版本 v${current.version}→v${nextVersion}`,
    {
      actor: actor.name,
      action: '归属调整',
      manholeId: current.id,
      manholeCode: current.code,
      segment: targetInfo.code,
      detail: `管段归属 ${current.segment}→${targetInfo.code}，责任人 ${current.ownerCaretaker}→${targetInfo.caretaker}`,
      fromVersion: current.version,
      toVersion: nextVersion,
    },
  )

  // 责任口径改完后，该管段的井体状态按新的归属重算一次。
  const recalc = recalcSegment(actor, targetInfo.code, '归属调整后按新归属重算')
  nextRows = listRows(MANHOLE_KEY)
  const refreshed = present(nextRows.find((row) => Number(row.id) === id)!)
  return {
    ok: true,
    message: recalc.message,
    current: refreshed,
  }
}

/** 按新归属重算一个管段内全部未办结井的井体状态；值没变的不动，办结井保持只读。 */
export function recalcSegment(
  actor: Actor,
  segment: string,
  reason: string,
): ManholeServiceResult & { recalculated: number } {
  const rows = listRows(MANHOLE_KEY)
  let recalculated = 0
  let skippedLocked = 0
  const next = rows.map((row) => {
    if (String(row['所属管段']) !== segment) {
      return row
    }
    const view = present(row)
    if (view.locked) {
      skippedLocked += 1
      return row
    }
    const body = deriveBody(view.cover, view.body)
    if (body === String(row['井体状态'] ?? '')) {
      return row
    }
    recalculated += 1
    return { ...row, 井体状态: body, version: view.version + 1 }
  })
  if (recalculated > 0) {
    saveRows(MANHOLE_KEY, next)
  }
  appendAudit({
    actor: actor.name,
    action: '重算井体状态',
    manholeId: null,
    manholeCode: '',
    segment,
    ok: true,
    gate: '校验通过',
    detail: `${reason}：重算 ${recalculated} 口${skippedLocked ? `，办结跳过 ${skippedLocked} 口` : ''}`,
    fromVersion: null,
    toVersion: null,
  })
  return {
    ok: true,
    recalculated,
    message: `管段「${segment}」井体状态已按新归属重算：更新 ${recalculated} 口${
      skippedLocked ? `，办结井 ${skippedLocked} 口保持只读` : ''
    }`,
  }
}

export type { AuditEntry }
export function manholeHistory(manholeId?: number): AuditEntry[] {
  const rows = listAudit()
  if (manholeId === undefined) {
    return rows
  }
  return rows.filter((item) => item.manholeId === manholeId)
}
