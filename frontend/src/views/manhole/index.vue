<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>检查井维护管理</h2>
        <p class="page-desc">每口井的归属只认所属管段：只有本管段养护工能改井盖状况与井深；养护办结的井整条受控只读；同段井编号不得重号。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检查井</button>
        <button class="btn" type="button" @click="showAudit = !showAudit">
          {{ showAudit ? '收起养护留痕' : '查看养护留痕' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出检查井维护清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="identity-pick">
        <span>当前身份</span>
        <select :value="session.actorName" @change="onSwitchActor">
          <option v-for="name in session.actorOptions" :key="name" :value="name">
            {{ name }}{{ actorByName(name).admin ? '（值班管理员）' : '（养护工）' }}
          </option>
        </select>
      </label>
      <p class="identity-scope">
        <template v-if="session.actor.admin">
          管理员口径：可查看全部井档、可调整井的管段归属（详情页），但不能替养护工改井盖状况与井深。
        </template>
        <template v-else>
          本管段责任：{{ session.actor.segments.join('、') }}；只能登记、改动、流转这些管段下的井，跨管段提交一律退回并留痕。
        </template>
      </p>
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>
            <RouterLink class="link" :to="`/manhole/${row.id}`">{{ row.code }}</RouterLink>
            <span v-if="row.legacySegment" class="tag tag-legacy" title="既有井档，按原层级保留">老档</span>
          </td>
          <td>{{ row.segment }}</td>
          <td>{{ row.ownerCaretaker }}</td>
          <td>{{ row.cover }}</td>
          <td>{{ row.depth }}</td>
          <td>{{ row.inspector }}</td>
          <td>{{ row.inspectDate }}</td>
          <td>
            {{ row.body }}
            <span v-if="row.locked" class="tag tag-locked">办结只读</span>
          </td>
          <td>{{ row.measure || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无检查井维护数据，可先登记检查井</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条检查井维护记录 · 列表与详情取同一份数据</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <div v-if="showAudit" class="audit-panel">
      <h3>养护留痕（谁、什么时候、想动哪口井、拦在哪一道，均可倒查）</h3>
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>按井编号/管段/操作人检索</span>
          <input v-model="auditKeyword" placeholder="输入关键字" />
        </label>
        <label class="filter-item">
          <span>只看被退回</span>
          <input v-model="auditBlockedOnly" type="checkbox" />
        </label>
      </form>
      <table class="data-table audit-table">
        <thead>
          <tr><th>时间</th><th>操作人</th><th>动作</th><th>井</th><th>管段</th><th>结果</th><th>环节</th><th>说明</th><th>版本</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in filteredAudit" :key="entry.id" :class="{ 'row-blocked': !entry.ok }">
            <td>{{ formatTime(entry.at) }}</td>
            <td>{{ entry.actor }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.manholeCode || (entry.manholeId ? `#${entry.manholeId}` : '—') }}</td>
            <td>{{ entry.segment || '—' }}</td>
            <td>
              <span :class="entry.ok ? 'success-text' : 'error-text'">{{ entry.ok ? '通过' : '退回' }}</span>
            </td>
            <td>{{ entry.gate }}</td>
            <td>{{ entry.detail }}</td>
            <td>{{ entry.fromVersion ?? '—' }} → {{ entry.toVersion ?? '—' }}</td>
          </tr>
          <tr v-if="!filteredAudit.length">
            <td colspan="9" class="empty-state">暂无留痕记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记检查井</h3>
        <p class="modal-hint">
          归属管段按当前身份的责任范围锁定，不允许给别的管段登记；同一管段下井编号不能重号。
        </p>
        <template v-if="session.actor.admin">
          <p class="error-text">值班管理员不直接登记井档，请切换为本管段养护工后再登记。</p>
        </template>
        <template v-else>
          <label class="form-item">
            <span>所属管段</span>
            <select v-model="createForm.segment" required>
              <option v-for="seg in ownSegments" :key="seg.code" :value="seg.code">
                {{ seg.name }}
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>井编号</span>
            <input v-model="createForm.code" placeholder="如 DRAI0001-J03" required />
          </label>
          <label class="form-item">
            <span>井盖状况</span>
            <select v-model="createForm.cover">
              <option v-for="cover in coverStatuses" :key="cover" :value="cover">{{ cover }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>井深（米）</span>
            <input v-model="createForm.depth" placeholder="如 2.8" inputmode="decimal" required />
          </label>
          <label class="form-item">
            <span>检查人</span>
            <input v-model="createForm.inspector" :placeholder="`默认 ${session.actor.name}`" />
          </label>
          <label class="form-item">
            <span>检查日期</span>
            <input v-model="createForm.inspectDate" type="date" />
          </label>
          <label class="form-item">
            <span>养护措施</span>
            <input v-model="createForm.measure" placeholder="如 例行开盖检查" />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="createOpen = false">取消</button>
            <button class="btn primary" type="submit">提交登记</button>
          </div>
        </template>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import type { AuditEntry, ManholeView } from '@/data/manhole/types'
import {
  COVER_STATUS,
  type Actor,
} from '@/data/manhole/types'
import {
  listManholes,
  manholeHistory,
  registerManhole,
  runManholeAction,
} from '@/data/manhole/manhole-service'
import { actorByName, SEGMENTS } from '@/data/manhole/segments'
import { useManholeSession } from '@/stores/manhole-session'

const session = useManholeSession()

const columns = [
  { key: 'code', label: '井编号' },
  { key: 'segment', label: '所属管段' },
  { key: 'ownerCaretaker', label: '管段责任人' },
  { key: 'cover', label: '井盖状况' },
  { key: 'depth', label: '井深' },
  { key: 'inspector', label: '检查人' },
  { key: 'inspectDate', label: '检查日期' },
  { key: 'body', label: '井体状态' },
  { key: 'measure', label: '养护措施' },
]
const filterFields = ['井编号', '所属管段', '井盖状况']
const actions = ['提交检查', '确认养护', '提出维修']
const statuses = ['待检查', '检查中', '已养护', '需维修']
const coverStatuses = [...COVER_STATUS]

const rows = ref<ManholeView[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})

const showAudit = ref(false)
const auditRows = ref<AuditEntry[]>([])
const auditKeyword = ref('')
const auditBlockedOnly = ref(false)

const createOpen = ref(false)
const createError = ref('')
const emptyForm = () => ({
  segment: session.actor.admin ? '' : session.actor.segments[0] ?? '',
  code: '',
  cover: '完好',
  depth: '',
  inspector: '',
  inspectDate: new Date().toISOString().slice(0, 10),
  measure: '',
})
const createForm = ref(emptyForm())

const ownSegments = computed(() =>
  SEGMENTS.filter((seg) => session.actor.segments.includes(seg.code)),
)

const stats = computed(() => [
  { label: '待检查检查井', value: rows.value.filter((row) => row.status === '待检查').length },
  { label: '检查中检查井', value: rows.value.filter((row) => row.status === '检查中').length },
  { label: '已养护检查井', value: rows.value.filter((row) => row.status === '已养护').length },
  { label: '需维修检查井', value: rows.value.filter((row) => row.status === '需维修').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const filteredAudit = computed(() => {
  const keyword = auditKeyword.value.trim()
  return auditRows.value.filter((entry) => {
    if (auditBlockedOnly.value && entry.ok) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [entry.actor, entry.action, entry.manholeCode, entry.segment, entry.detail]
      .join(' ')
      .includes(keyword)
  })
})

function flashSuccess(message: string) {
  successMessage.value = message
  window.setTimeout(() => {
    successMessage.value = ''
  }, 5000)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('manhole')
}

function onSwitchActor(event: Event) {
  session.setActor((event.target as HTMLSelectElement).value)
  createForm.value = emptyForm()
  reload()
}

function openCreate() {
  createError.value = ''
  createForm.value = emptyForm()
  createOpen.value = true
}

function submitCreate() {
  const result = registerManhole(session.actor as Actor, createForm.value)
  if (!result.ok) {
    createError.value = result.message
  } else {
    createOpen.value = false
    reload()
    flashSuccess(result.message)
  }
}

function runAction(action: string, row: ManholeView) {
  errorMessage.value = ''
  // 动作提交带当前版本：并发时只认先到版本，后到者按冲突挡回。
  const result = runManholeAction(session.actor as Actor, row.id, action, row.version)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    flashSuccess(result.message)
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  const payload = listManholes(filters.value)
  rows.value = payload.items
  total.value = payload.total
  if (showAudit.value) {
    auditRows.value = manholeHistory()
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === 'drainage-pump:entries' || event.key === 'drainage-pump:manhole-audit') {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
})

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
</script>
