import type { Actor, SegmentInfo } from './types'

/**
 * 管段目录与养护责任花名册。
 * 正式管段与排水管网台账里的管段编号对齐；带 legacy 的是既有井档里的老层级，
 * 老档不搬家、不重置，仍给每段配一名责任人，兼容既有责任。
 */
export const SEGMENTS: SegmentInfo[] = [
  { code: 'DRAI-0001', name: '光明路干管 DRAI-0001', legacy: false, caretaker: '周建国' },
  { code: 'DRAI-0002', name: '滨河路干管 DRAI-0002', legacy: false, caretaker: '林卫民' },
  { code: 'DRAI-0003', name: '东站支管 DRAI-0003', legacy: false, caretaker: '赵守井' },
  { code: '检查井维护样例1', name: '老档管段·检查井维护样例1', legacy: true, caretaker: '孙老井' },
  { code: '检查井维护样例2', name: '老档管段·检查井维护样例2', legacy: true, caretaker: '孙老井' },
  { code: '检查井维护样例3', name: '老档管段·检查井维护样例3', legacy: true, caretaker: '何旧档' },
]

export const SEGMENT_BY_CODE: Map<string, SegmentInfo> = new Map(
  SEGMENTS.map((item) => [item.code, item]),
)

export function segmentInfo(code: string): SegmentInfo {
  return (
    SEGMENT_BY_CODE.get(code) ?? {
      code,
      name: `未入册管段 ${code}`,
      legacy: true,
      caretaker: '未指派',
    }
  )
}

/** 页面顶部的身份切换：演示跨管段提交被退回时，切到别的养护工即可复现。 */
export const ACTORS: Actor[] = [
  { name: '周建国', admin: false, segments: ['DRAI-0001'] },
  { name: '林卫民', admin: false, segments: ['DRAI-0002'] },
  { name: '赵守井', admin: false, segments: ['DRAI-0003'] },
  { name: '孙老井', admin: false, segments: ['检查井维护样例1', '检查井维护样例2'] },
  { name: '何旧档', admin: false, segments: ['检查井维护样例3'] },
  { name: '值班管理员', admin: true, segments: [] },
]

export function actorByName(name: string): Actor {
  return (
    ACTORS.find((item) => item.name === name) ?? { name, admin: false, segments: [] }
  )
}

/** 归属判定：井只认它所属的管段；管理员只做归属调整，不替养护工改井盖与井深。 */
export function ownsSegment(actor: Actor, segment: string): boolean {
  return actor.segments.includes(segment)
}
