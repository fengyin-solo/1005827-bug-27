<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>检查井维护管理</h2>
        <p class="page-desc">每口井只认所属管段：本管段养护工才能登记、改井盖状况与井深；养护办结整条受控只读。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检查井</button>
        <button class="btn" type="button" @click="openDrill">并发撞车演练</button>
        <button class="btn" type="button" @click="resetData">重置演示数据</button>
      </div>
    </header>

    <div class="identity-bar">
      <div class="identity-main">
        <span class="identity-label">当前身份</span>
        <select v-model="store.operatorId" @change="reload">
          <option v-for="crew in crewList" :key="crew.id" :value="crew.id">
            {{ crew.name }}（{{ crew.title }}）
          </option>
        </select>
        <span v-if="store.currentSegment" class="badge own">归属管段：{{ store.currentSegment }}</span>
        <span v-else class="badge readonly">无管段 · 全局只读</span>
      </div>
      <span class="identity-tip">井编号在同管段内不可重号；跨管段提交会在服务层挡回并留痕。</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>井编号 / 检查人</span>
        <input v-model="filters.keyword" placeholder="按井编号或检查人检索" />
      </label>
      <label class="filter-item">
        <span>所属管段</span>
        <select v-model="filters.segmentCode">
          <option value="">全部管段</option>
          <option v-for="seg in segmentList" :key="seg.code" :value="seg.code">{{ seg.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>井体状态</span>
        <select v-model="filters.bodyState">
          <option value="">全部井体状态</option>
          <option v-for="state in bodyStates" :key="state" :value="state">{{ state }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>井编号</th>
          <th>归属管段</th>
          <th>井盖状况</th>
          <th>井深(米)</th>
          <th>检查人</th>
          <th>检查日期</th>
          <th>井体状态</th>
          <th>档别/版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td><RouterLink :to="`/manhole/${row.id}`" class="link">{{ row[CODE_FIELD] }}</RouterLink></td>
          <td>
            {{ segmentNameOf(row.segmentCode) }}
            <span v-if="isOwner(row)" class="badge own">本管段</span>
            <span v-else class="badge foreign">外管段</span>
          </td>
          <td>{{ row[COVER_FIELD] }}</td>
          <td>{{ row[DEPTH_FIELD] }}</td>
          <td>{{ row[INSPECTOR_FIELD] }}</td>
          <td>{{ row[INSPECT_DATE_FIELD] }}</td>
          <td>{{ row[BODY_FIELD] }}</td>
          <td>
            <span :class="['badge', row.tier === 'legacy' ? 'legacy' : 'owned']">{{ TIER_LABEL[row.tier as ArchiveTier] }}</span>
            <span class="version-text">v{{ row.version }}</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.status === FINISHED_STATUS" class="badge lock">受控只读</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row)">改井盖/井深</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无符合条件的检查井，可先在本管段登记检查井</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条检查井记录 · 井体状态随井盖状况同笔重算，列表与详情同源</span>
      <span v-if="feedback" :class="feedbackOk ? 'ok-text' : 'error-text'">{{ feedback }}</span>
    </footer>

    <!-- 登记 / 改动共用一个表单：校验口径完全一致 -->
    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <div class="modal-panel">
        <h3>{{ formMode === 'create' ? '登记检查井' : `改动检查井（${form.code}）` }}</h3>
        <p class="modal-sub">
          {{ formMode === 'create'
            ? `新井只登记在本人所属管段：${store.currentSegment}`
            : `只能改井盖状况与井深；当前版本 v${form.expectedVersion}，办结井不可改。` }}
        </p>
        <div class="form-grid">
          <label class="form-item">
            <span>井编号 *</span>
            <input v-model="form.code" :disabled="formMode === 'edit'" placeholder="如 MANH-0010" />
          </label>
          <label class="form-item">
            <span>所属管段 *</span>
            <input :value="formMode === 'create' ? store.currentSegment : segmentNameOf(form.segmentCode)" disabled />
          </label>
          <label class="form-item">
            <span>井盖状况 *</span>
            <select v-model="form.cover">
              <option v-for="value in coverValues" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>井深(米) *</span>
            <input v-model.number="form.depth" type="number" step="0.1" :min="0.2" :max="30" />
          </label>
          <label v-if="formMode === 'create'" class="form-item">
            <span>检查日期</span>
            <input v-model="form.inspectDate" type="date" />
          </label>
          <label v-if="formMode === 'create'" class="form-item full">
            <span>养护措施</span>
            <input v-model="form.measure" placeholder="如 清淤、更换防坠网（可留空）" />
          </label>
        </div>
        <p v-if="formError" class="error-text form-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">
            {{ formMode === 'create' ? '提交登记' : '提交改动' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 并发撞车演练：同一口井同时来两笔，按归属/到达顺序仲裁 -->
    <div v-if="drillOpen" class="modal-mask" @click.self="closeDrill">
      <div class="modal-panel wide">
        <h3>并发撞车演练</h3>
        <p class="modal-sub">两笔提交视为同一时刻到达同一口井，按「归属优先、同归属先到先得」仲裁；冲突方挡回并写审计。</p>
        <div class="drill-grid">
          <div class="drill-col">
            <h4>第一笔（先到）</h4>
            <label class="form-item"><span>养护工</span>
              <select v-model="drill.firstActor">
                <option v-for="crew in workerCrew" :key="crew.id" :value="crew.id">{{ crew.name }} · {{ segmentNameOf(crew.segmentCode) }}</option>
              </select>
            </label>
            <label class="form-item"><span>动作</span>
              <select v-model="drill.firstKind">
                <option value="update">改井盖/井深</option>
                <option value="create">登记新井</option>
              </select>
            </label>
            <label v-if="drill.firstKind === 'update'" class="form-item"><span>目标井</span>
              <select v-model.number="drill.firstTargetId">
                <option v-for="row in rows" :key="row.id" :value="row.id">
                  {{ row[CODE_FIELD] }}（{{ segmentNameOf(row.segmentCode) }}）
                </option>
              </select>
            </label>
            <template v-else>
              <label class="form-item"><span>新井编号</span><input v-model="drill.firstCode" /></label>
              <label class="form-item"><span>管段（登记只认本管段）</span>
                <select v-model="drill.firstSegmentCode">
                  <option v-for="seg in segmentList" :key="seg.code" :value="seg.code">{{ seg.name }}</option>
                </select>
              </label>
            </template>
          </div>
          <div class="drill-col">
            <h4>第二笔（后到）</h4>
            <label class="form-item"><span>养护工</span>
              <select v-model="drill.secondActor">
                <option v-for="crew in workerCrew" :key="crew.id" :value="crew.id">{{ crew.name }} · {{ segmentNameOf(crew.segmentCode) }}</option>
              </select>
            </label>
            <label class="form-item"><span>动作</span>
              <select v-model="drill.secondKind">
                <option value="update">改井盖/井深</option>
                <option value="create">登记新井</option>
              </select>
            </label>
            <label v-if="drill.secondKind === 'update'" class="form-item"><span>目标井</span>
              <select v-model.number="drill.secondTargetId">
                <option v-for="row in rows" :key="row.id" :value="row.id">
                  {{ row[CODE_FIELD] }}（{{ segmentNameOf(row.segmentCode) }}）
                </option>
              </select>
            </label>
            <template v-else>
              <label class="form-item"><span>新井编号</span><input v-model="drill.secondCode" /></label>
              <label class="form-item"><span>管段（登记只认本管段）</span>
                <select v-model="drill.secondSegmentCode">
                  <option v-for="seg in segmentList" :key="seg.code" :value="seg.code">{{ seg.name }}</option>
                </select>
              </label>
            </template>
          </div>
        </div>
        <p class="modal-sub">快捷场景：
          <button class="link" type="button" @click="fillDrill('foreign')">外管段 vs 本管段抢改同一口井</button>
          ·
          <button class="link" type="button" @click="fillDrill('same')">同管段两人同改一井</button>
          ·
          <button class="link" type="button" @click="fillDrill('dup')">同编号重号同时登记</button>
        </p>
        <ul v-if="drillResults.length" class="drill-results">
          <li v-for="(line, index) in drillResults" :key="index" :class="line.ok ? 'ok-text' : 'error-text'">
            第 {{ index + 1 }} 笔：{{ line.message }}
          </li>
        </ul>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDrill">关闭</button>
          <button class="btn primary" type="button" @click="runDrill">按同时到达执行</button>
        </div>
      </div>
    </div>

    <!-- 审计留痕：谁、什么时候、想动哪口井、拦在哪都可倒查 -->
    <section class="audit-panel">
      <header class="audit-head">
        <h3>责任审计留痕</h3>
        <input v-model="auditKeyword" placeholder="按养护工 / 井编号 / 详情检索" @input="reloadAudits" />
      </header>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>养护工</th><th>关口</th><th>动作</th><th>目标井</th><th>结果</th><th>详情</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in audits" :key="entry.id">
            <td>{{ formatTime(entry.time) }}</td>
            <td>{{ entry.actorName }}<span class="muted-text">（{{ entry.actorSegment }}）</span></td>
            <td>{{ entry.stage }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.target }}</td>
            <td><span :class="['badge', entry.result === '通过' ? 'own' : 'reject']">{{ entry.result }}</span></td>
            <td>{{ entry.detail }}</td>
          </tr>
          <tr v-if="!audits.length">
            <td colspan="7" class="empty-state">暂无留痕：执行登记、改动、流转或撞车演练后，这里可逐笔倒查</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  COVER_VALUES,
  createManhole,
  listManholeAudits,
  listManholes,
  manholeStats,
  runManholeAction,
  submitManholeBatch,
  updateManhole,
  type BatchRequest,
} from '@/api/manhole-service'
import {
  BODY_FIELD,
  CODE_FIELD,
  COVER_FIELD,
  DEPTH_FIELD,
  FINISHED_STATUS,
  INSPECT_DATE_FIELD,
  INSPECTOR_FIELD,
  MANHOLE_CREW,
  MANHOLE_KEY,
  MANHOLE_SEGMENTS,
  belongsTo,
  segmentNameOf,
  TIER_LABEL,
  type ArchiveTier,
  type CoverValue,
  type ManholeAuditEntry,
  type ManholeRecord,
} from '@/data/manhole-domain'
import { resetRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const crewList = MANHOLE_CREW
const workerCrew = MANHOLE_CREW.filter((crew) => crew.segmentCode)
const segmentList = MANHOLE_SEGMENTS
const coverValues = COVER_VALUES as readonly CoverValue[]
const actions = ['提交检查', '确认养护', '提出维修']
const bodyStates = ['井况正常', '井体破损', '井口危险', '井况待评']

const rows = ref<ManholeRecord[]>([])
const total = ref(0)
const stats = ref(manholeStats())
const filters = reactive({ keyword: '', segmentCode: '', bodyState: '' })
const feedback = ref('')
const feedbackOk = ref(false)

const statusSummary = computed(() =>
  ['待检查', '检查中', '已养护', '需维修'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOwner(row: ManholeRecord): boolean {
  return belongsTo(row, store.currentCrew)
}

function showFeedback(message: string, ok: boolean) {
  feedback.value = message
  feedbackOk.value = ok
}

function reload() {
  feedback.value = ''
  const payload = listManholes({
    keyword: filters.keyword,
    segmentCode: filters.segmentCode,
    bodyState: filters.bodyState,
  })
  rows.value = payload.items
  total.value = payload.total
  stats.value = manholeStats()
}

function resetFilters() {
  filters.keyword = ''
  filters.segmentCode = ''
  filters.bodyState = ''
  reload()
}

// ---- 登记 / 改动表单（新增与改动同一套校验口径） ----
const formOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formError = ref('')
const editingId = ref(0)
const form = reactive({
  code: '',
  segmentCode: '',
  cover: '完好' as CoverValue,
  depth: 3,
  measure: '',
  inspectDate: '',
  expectedVersion: 1,
})

function openCreate() {
  if (!store.currentSegment) {
    showFeedback('值班管理员不挂管段，请切换为管段养护工后再登记', false)
    return
  }
  formMode.value = 'create'
  form.code = `MANH-${String(Date.now()).slice(-4)}`
  form.segmentCode = store.currentCrew.segmentCode
  form.cover = '完好'
  form.depth = 3
  form.measure = ''
  form.inspectDate = new Date().toISOString().slice(0, 10)
  form.expectedVersion = 1
  formError.value = ''
  formOpen.value = true
}

function openEdit(row: ManholeRecord) {
  formMode.value = 'edit'
  editingId.value = row.id
  form.code = String(row[CODE_FIELD])
  form.segmentCode = row.segmentCode
  form.cover = String(row[COVER_FIELD]) as CoverValue
  form.depth = Number(row[DEPTH_FIELD])
  form.measure = ''
  form.inspectDate = ''
  form.expectedVersion = row.version
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function submitForm() {
  const actorId = store.operatorId
  const result =
    formMode.value === 'create'
      ? createManhole(actorId, {
          code: form.code,
          segmentCode: form.segmentCode,
          cover: form.cover,
          depth: Number(form.depth),
          measure: form.measure,
          inspectDate: form.inspectDate,
        })
      : updateManhole(actorId, {
          id: editingId.value,
          cover: form.cover,
          depth: Number(form.depth),
          expectedVersion: form.expectedVersion,
        })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  formError.value = ''
  formOpen.value = false
  showFeedback(result.message, true)
  reload()
  reloadAudits()
}

function runAction(action: string, row: ManholeRecord) {
  const result = runManholeAction(store.operatorId, row.id, action)
  showFeedback(result.message, result.ok)
  reload()
  reloadAudits()
}

// ---- 并发撞车演练 ----
const drillOpen = ref(false)
const drill = reactive({
  firstActor: 'u03',
  firstKind: 'update' as 'update' | 'create',
  firstTargetId: 1,
  firstCode: 'MANH-9001',
  firstSegmentCode: 'DRAI-0001',
  secondActor: 'u01',
  secondKind: 'update' as 'update' | 'create',
  secondTargetId: 1,
  secondCode: 'MANH-9001',
  secondSegmentCode: 'DRAI-0001',
})
const drillResults = ref<{ ok: boolean; message: string }[]>([])

function openDrill() {
  drillOpen.value = true
  drillResults.value = []
}

function closeDrill() {
  drillOpen.value = false
}

function fillDrill(scene: 'foreign' | 'same' | 'dup') {
  if (scene === 'foreign') {
    drill.firstKind = 'update'
    drill.firstActor = 'u03'
    drill.firstTargetId = 1
    drill.secondKind = 'update'
    drill.secondActor = 'u01'
    drill.secondTargetId = 1
  } else if (scene === 'same') {
    drill.firstKind = 'update'
    drill.firstActor = 'u01'
    drill.firstTargetId = 1
    drill.secondKind = 'update'
    drill.secondActor = 'u02'
    drill.secondTargetId = 1
  } else {
    drill.firstKind = 'create'
    drill.firstActor = 'u01'
    drill.firstCode = 'MANH-9001'
    drill.firstSegmentCode = 'DRAI-0001'
    drill.secondKind = 'create'
    drill.secondActor = 'u02'
    drill.secondCode = 'MANH-9001'
    drill.secondSegmentCode = 'DRAI-0001'
  }
  drillResults.value = []
}

function buildDrillRequest(
  order: 'first' | 'second',
  seq: number,
): BatchRequest | undefined {
  const actorId = order === 'first' ? drill.firstActor : drill.secondActor
  const kind = order === 'first' ? drill.firstKind : drill.secondKind
  if (kind === 'update') {
    const id = order === 'first' ? drill.firstTargetId : drill.secondTargetId
    return {
      kind: 'update',
      seq,
      actorId,
      input: { id, expectedVersion: 1, cover: '缺失', depth: 3.5 },
    }
  }
  const code = order === 'first' ? drill.firstCode : drill.secondCode
  const segmentCode = order === 'first' ? drill.firstSegmentCode : drill.secondSegmentCode
  return {
    kind: 'create',
    seq,
    actorId,
    input: { code, segmentCode, cover: '破损', depth: 3.5 },
  }
}

function runDrill() {
  const first = buildDrillRequest('first', 0)
  const second = buildDrillRequest('second', 1)
  const requests = [first, second].filter((item): item is BatchRequest => Boolean(item))
  if (requests.length < 2) {
    drillResults.value = [{ ok: false, message: '请把两笔提交都配置完整' }]
    return
  }
  const results = submitManholeBatch(requests)
  drillResults.value = results.map((result) => ({ ok: result.ok, message: result.message }))
  reload()
  reloadAudits()
}

// ---- 审计留痕 ----
const audits = ref<ManholeAuditEntry[]>([])
const auditKeyword = ref('')

function reloadAudits() {
  audits.value = listManholeAudits(auditKeyword.value).slice(0, 30)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (num: number) => `${num}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function resetData() {
  resetRows(MANHOLE_KEY)
  showFeedback('检查井演示数据已重置，既有档已按新责任口径重算井体状态', true)
  reload()
  reloadAudits()
}

onMounted(() => {
  reload()
  reloadAudits()
})
</script>
