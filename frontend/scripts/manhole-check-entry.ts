import {
  createManhole,
  getManhole,
  listManholes,
  listManholeAudits,
  manholeStats,
  runManholeAction,
  submitManholeBatch,
  updateManhole,
} from '@/api/manhole-service'
import {
  BODY_FIELD,
  CODE_FIELD,
  COVER_FIELD,
  DEPTH_FIELD,
  FINISHED_STATUS,
  SEGMENT_FIELD,
  deriveBodyState,
} from '@/data/manhole-domain'

type Check = { name: string; pass: boolean; detail: string }

function expect(name: string, condition: boolean, detail = ''): Check {
  return { name, pass: condition, detail }
}

export default function runChecks(): Check[] {
  const checks: Check[] = []

  // 1. 迁移：既有井档保留原层级，井体状态按新归属口径重算一次
  const all = listManholes({}).items
  const legacy1 = getManhole(1)!
  const legacy2 = getManhole(2)!
  const legacy3 = getManhole(3)!
  checks.push(expect('迁移：三条既有档全部在档', all.length === 3, `实际 ${all.length} 条`))
  checks.push(expect('迁移：既有档标记为 legacy', all.every((r) => r.tier === 'legacy')))
  checks.push(expect('迁移：井1 原层级管段被认亲为 DRAI-0001', legacy1.segmentCode === 'DRAI-0001', `实际 ${legacy1.segmentCode}`))
  checks.push(expect('迁移：井1 井体状态 完好→井况正常', String(legacy1[BODY_FIELD]) === '井况正常', `实际 ${legacy1[BODY_FIELD]}（原值 ${legacy1.原井体状态}）`))
  checks.push(expect('迁移：井2 破损→井体破损，修正旧的“井况正常”', String(legacy2[BODY_FIELD]) === '井体破损', `实际 ${legacy2[BODY_FIELD]}`))
  checks.push(expect('迁移：井3 完好→井况正常', String(legacy3[BODY_FIELD]) === '井况正常', `实际 ${legacy3[BODY_FIELD]}`))
  checks.push(expect('迁移：原井体状态留底', legacy1.原井体状态 === '检查井维护样例1' && legacy2.原井体状态 === '井况正常'))
  const migrationAudits = listManholeAudits().filter((a) => a.stage === '迁移重算')
  checks.push(expect('迁移：每口井一条重算留痕', migrationAudits.length === 3, `实际 ${migrationAudits.length} 条`))

  // 2. 登记：只认本管段
  const okCreate = createManhole('u01', { code: 'MANH-1001', segmentCode: 'DRAI-0001', cover: '完好', depth: 2.5 })
  checks.push(expect('登记：本管段登记通过', okCreate.ok, okCreate.message))
  const newId = okCreate.data?.record.id ?? -1
  const created = getManhole(newId)
  checks.push(expect('登记：新井标为责任档', created?.tier === 'owned'))
  checks.push(expect('登记：井体状态随井盖核定', String(created?.[BODY_FIELD]) === '井况正常'))

  const foreignCreate = createManhole('u03', { code: 'MANH-2001', segmentCode: 'DRAI-0001', cover: '完好', depth: 2.5 })
  checks.push(expect('登记：跨管段登记挡在【归属】', !foreignCreate.ok && foreignCreate.gate === '归属', foreignCreate.message))

  const dupCreate = createManhole('u01', { code: 'MANH-1001', segmentCode: 'DRAI-0001', cover: '完好', depth: 2.5 })
  checks.push(expect('登记：同管段重号挡在【重号】', !dupCreate.ok && dupCreate.gate === '重号', dupCreate.message))

  // 同编号落在不同管段不算重号
  const otherSegment = createManhole('u03', { code: 'MANH-1001', segmentCode: 'DRAI-0002', cover: '破损', depth: 3 })
  checks.push(expect('登记：同编号跨管段不构成重号', otherSegment.ok, otherSegment.message))

  const adminCreate = createManhole('admin', { code: 'MANH-X', segmentCode: 'DRAI-0001', cover: '完好', depth: 2 })
  checks.push(expect('登记：值班管理员无管段挡在【身份】', !adminCreate.ok && adminCreate.gate === '身份', adminCreate.message))

  const badDepth = createManhole('u01', { code: 'MANH-1002', segmentCode: 'DRAI-0001', cover: '完好', depth: 0 })
  checks.push(expect('登记：井深非法挡在【井深】', !badDepth.ok && badDepth.gate === '井深', badDepth.message))

  // 3. 改动：只有本管段能改井盖状况与井深，井体状态同笔重算
  const before = getManhole(newId)!
  const ownUpdate = updateManhole('u01', { id: newId, cover: '缺失', depth: 5.2, expectedVersion: before.version })
  checks.push(expect('改动：本管段改动通过', ownUpdate.ok, ownUpdate.message))
  const after = getManhole(newId)!
  checks.push(expect('改动：井盖/井深已更新', String(after[COVER_FIELD]) === '缺失' && Number(after[DEPTH_FIELD]) === 5.2))
  checks.push(expect('改动：井体状态同笔重算为井口危险', String(after[BODY_FIELD]) === '井口危险', `实际 ${after[BODY_FIELD]}`))
  checks.push(expect('改动：版本号递增', after.version === 2, `实际 v${after.version}`))

  const foreignUpdate = updateManhole('u03', { id: newId, cover: '完好', depth: 5.2 })
  checks.push(expect('改动：外管段改动挡在【归属】', !foreignUpdate.ok && foreignUpdate.gate === '归属', foreignUpdate.message))
  const untouched = getManhole(newId)!
  checks.push(expect('改动：挡回后井体状态不被污染', String(untouched[COVER_FIELD]) === '缺失'))

  // 4. 同一口井两人并发改动：只认先到版本
  const staleUpdate = updateManhole('u01', { id: newId, cover: '破损', depth: 5, expectedVersion: 1 })
  checks.push(expect('并发：旧版本提交挡在【乐观锁】', !staleUpdate.ok && staleUpdate.gate === '乐观锁', staleUpdate.message))

  // 5. 养护办结：整条受控只读
  const finish = runManholeAction('u01', newId, '确认养护')
  checks.push(expect('办结：本管段确认养护通过', finish.ok, finish.message))
  const finished = getManhole(newId)!
  checks.push(expect('办结：状态为已养护', String(finished.status) === FINISHED_STATUS))
  const editFinished = updateManhole('u01', { id: newId, cover: '完好', depth: 5, expectedVersion: finished.version })
  checks.push(expect('办结：办结井改动挡在【办结受控】', !editFinished.ok && editFinished.gate === '办结受控', editFinished.message))
  const actionFinished = runManholeAction('u01', newId, '提出维修')
  checks.push(expect('办结：办结井流转也挡在【办结受控】', !actionFinished.ok && actionFinished.gate === '办结受控', actionFinished.message))

  // 外管段不能驱动本管段井的流转
  const foreignAction = runManholeAction('u03', 1, '提出维修')
  checks.push(expect('流转：外管段“提出维修”挡在【归属】', !foreignAction.ok && foreignAction.gate === '归属', foreignAction.message))

  // 6. 并发撞车：外管段 vs 本管段抢改同一口井（井1 属 DRAI-0001）
  // 先把井1 从“待检查”推进到非办结（它本来就是待检查，可直接改）
  const batch1 = submitManholeBatch([
    { kind: 'update', seq: 0, actorId: 'u03', input: { id: 1, cover: '缺失', depth: 6, expectedVersion: 1 } },
    { kind: 'update', seq: 1, actorId: 'u01', input: { id: 1, cover: '破损', depth: 3.4, expectedVersion: 1 } },
  ])
  checks.push(expect('撞车(归属优先)：外管段先到也被仲裁挡回', !batch1[0].ok && batch1[0].gate === '并发仲裁', batch1[0].message))
  checks.push(expect('撞车(归属优先)：归属方后到仍生效', batch1[1].ok, batch1[1].message))
  const well1 = getManhole(1)!
  checks.push(expect('撞车(归属优先)：井1 取归属方版本（破损）', String(well1[COVER_FIELD]) === '破损' && well1.version === 2, `实际 ${well1[COVER_FIELD]} v${well1.version}`))

  // 7. 同管段两人同改一井：先到先得，后到因乐观锁/仲裁失败
  const batch2 = submitManholeBatch([
    { kind: 'update', seq: 0, actorId: 'u01', input: { id: 1, cover: '完好', depth: 3.2, expectedVersion: 2 } },
    { kind: 'update', seq: 1, actorId: 'u02', input: { id: 1, cover: '缺失', depth: 9, expectedVersion: 2 } },
  ])
  checks.push(expect('撞车(同归属)：先到通过', batch2[0].ok, batch2[0].message))
  checks.push(expect('撞车(同归属)：后到挡在【并发仲裁】', !batch2[1].ok && batch2[1].gate === '并发仲裁', batch2[1].message))
  const well1b = getManhole(1)!
  checks.push(expect('撞车(同归属)：只认先到一版（完好）', String(well1b[COVER_FIELD]) === '完好' && well1b.version === 3, `实际 ${well1b[COVER_FIELD]} v${well1b.version}`))

  // 8. 同时撞同一编号：外管段登记挡在【归属】；归属方登记成立；重号由【重号】关口兜
  const code = 'MANH-7777'
  const batch3 = submitManholeBatch([
    { kind: 'create', seq: 0, actorId: 'u03', input: { code, segmentCode: 'DRAI-0001', cover: '完好', depth: 3 } },
    { kind: 'create', seq: 1, actorId: 'u01', input: { code, segmentCode: 'DRAI-0001', cover: '完好', depth: 3 } },
  ])
  // 第一笔跨管段登记挡在归属关口；第二笔归属方登记成功（编号此时仍空闲）
  checks.push(expect('撞车(新增vs新增)：外管段登记挡在【归属】', !batch3[0].ok && batch3[0].gate === '归属', batch3[0].message))
  checks.push(expect('撞车(新增vs新增)：归属方登记通过', batch3[1].ok, batch3[1].message))

  // 9a. 改动(update) 与 新增(create) 同时撞同一口在档井的编号：
  //   - 在档编号的登记属于【重号】，与并发无关，必被挡；
  //   - 归属方的正常改动不受影响，同批放行。
  const well1Code = String(getManhole(1)![CODE_FIELD]) // MANH-0001（DRAI-0001、v3、未办结）
  const batch4 = submitManholeBatch([
    { kind: 'update', seq: 0, actorId: 'u01', input: { id: 1, cover: '缺失', depth: 8, expectedVersion: 3 } },
    { kind: 'create', seq: 1, actorId: 'u02', input: { code: well1Code, segmentCode: 'DRAI-0001', cover: '完好', depth: 3 } },
  ])
  checks.push(expect('撞车(改动vs新增)：归属方改动通过', batch4[0].ok, batch4[0].message))
  checks.push(expect('撞车(改动vs新增)：登记在档编号挡在【重号】', !batch4[1].ok && batch4[1].gate === '重号', batch4[1].message))
  const well1c = getManhole(1)!
  checks.push(expect('撞车(改动vs新增)：改动已生效（缺失/v4），登记未落库', String(well1c[COVER_FIELD]) === '缺失' && well1c.version === 4, `实际 ${well1c[COVER_FIELD]} v${well1c.version}`))

  // 9b. 两个新增抢同一个「尚空闲」编号：归属方优先于跨管段方（batch3 已覆盖），
  //     同归属两人抢注时只认先到，后到挡在【重号】。
  const freeCode = 'MANH-8888'
  const batch5 = submitManholeBatch([
    { kind: 'create', seq: 0, actorId: 'u01', input: { code: freeCode, segmentCode: 'DRAI-0001', cover: '完好', depth: 3 } },
    { kind: 'create', seq: 1, actorId: 'u02', input: { code: freeCode, segmentCode: 'DRAI-0001', cover: '完好', depth: 3 } },
  ])
  checks.push(expect('撞车(同号抢注)：先到登记通过', batch5[0].ok, batch5[0].message))
  checks.push(expect('撞车(同号抢注)：后到按重号挡回', !batch5[1].ok && batch5[1].gate === '重号', batch5[1].message))

  // 9. 审计：谁、什么时候、想动哪口井、拦在哪都可倒查
  const rejects = listManholeAudits().filter((a) => a.result === '挡回')
  checks.push(expect('留痕：挡回条目充足（归属/重号/锁/仲裁/乐观锁）', rejects.length >= 8, `实际 ${rejects.length} 条`))
  const hasWho = rejects.every((a) => a.actorName && a.time)
  checks.push(expect('留痕：每条都有谁、什么时候', hasWho))
  const hasGate = rejects.every((a) => a.stage && a.detail.includes('【'))
  checks.push(expect('留痕：每条写明拦在哪道关口', hasGate, rejects.find((a) => !(a.stage && a.detail.includes('【')))?.detail ?? ''))

  // 10. 列表与详情同源：直接从同一存储读取，值一致
  const listed = listManholes({ keyword: 'MANH-0001' }).items[0]
  const detail = getManhole(1)!
  checks.push(expect('同源：列表井体状态 === 详情井体状态', String(listed[BODY_FIELD]) === String(detail[BODY_FIELD])))
  checks.push(expect('同源：列表井深 === 详情井深', Number(listed[DEPTH_FIELD]) === Number(detail[DEPTH_FIELD])))

  const stats = manholeStats()
  checks.push(expect('统计：能算出在档/办结数', stats[0].value > 0 && stats[3].value >= 1, JSON.stringify(stats)))

  void SEGMENT_FIELD
  void deriveBodyState
  return checks
}
