<template>
  <section class="page" data-module="manhole-detail">
    <header class="page-head">
      <div>
        <h2>检查井详情</h2>
        <p class="page-desc">
          <RouterLink to="/manhole" class="link">← 返回检查井列表</RouterLink>
          详情与列表读同一份在档数据，井体状态随井盖状况同笔重算。
        </p>
      </div>
      <div class="page-actions">
        <button
          class="btn primary"
          type="button"
          :disabled="!canEdit"
          :title="canEditReason || '改动井盖状况与井深'"
          @click="openEdit"
        >改井盖状况 / 井深</button>
      </div>
    </header>

    <div v-if="!record" class="detail-card">
      <p class="error-text">没有找到这口检查井，可能已被重置或编号有误。</p>
    </div>

    <template v-else>
      <div class="identity-bar">
        <div class="identity-main">
          <span class="identity-label">当前身份</span>
          <strong>{{ store.currentCrew.name }}</strong>
          <span v-if="owner" class="badge own">本管段 · 可改动</span>
          <span v-else class="badge foreign">外管段 / 无管段 · 只读</span>
          <span v-if="record.status === FINISHED_STATUS" class="badge lock">已养护办结 · 整条受控</span>
        </div>
        <span class="identity-tip">归属管段：{{ segmentNameOf(record.segmentCode) }}（{{ record.segmentCode }}）</span>
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>在档信息</h3>
          <dl>
            <dt>井编号</dt><dd>{{ record[CODE_FIELD] }}</dd>
            <dt>归属管段</dt><dd>{{ segmentNameOf(record.segmentCode) }}</dd>
            <template v-if="record.原所属管段">
              <dt>原所属管段（既有档）</dt><dd class="muted-text">{{ record.原所属管段 }}</dd>
            </template>
            <dt>井盖状况</dt><dd>{{ record[COVER_FIELD] }}</dd>
            <dt>井深(米)</dt><dd>{{ record[DEPTH_FIELD] }}</dd>
            <dt>检查人</dt><dd>{{ record[INSPECTOR_FIELD] }}</dd>
            <dt>检查日期</dt><dd>{{ record[INSPECT_DATE_FIELD] }}</dd>
            <dt>养护措施</dt><dd>{{ record[MEASURE_FIELD] }}</dd>
          </dl>
        </article>
        <article class="detail-card">
          <h3>状态与责任</h3>
          <dl>
            <dt>井体状态</dt>
            <dd>
              {{ record[BODY_FIELD] }}
              <span class="muted-text">（由井盖状况「{{ record[COVER_FIELD] }}」推导）</span>
            </dd>
            <template v-if="record.原井体状态">
              <dt>原井体状态（迁移前）</dt><dd class="muted-text">{{ record.原井体状态 }}</dd>
            </template>
            <dt>流程状态</dt><dd>{{ record.status }}<span v-if="record.status === FINISHED_STATUS" class="badge lock">受控只读</span></dd>
            <dt>档案层级</dt><dd><span :class="['badge', record.tier === 'legacy' ? 'legacy' : 'owned']">{{ TIER_LABEL[record.tier as ArchiveTier] }}</span></dd>
            <dt>乐观锁版本</dt><dd>v{{ record.version }}（并发改动只认先到版本）</dd>
            <dt>建档时间</dt><dd>{{ formatTime(record.createdAt) }}</dd>
            <dt>最近改动</dt><dd>{{ formatTime(record.updatedAt) }}</dd>
          </dl>
        </article>
      </div>

      <p v-if="!canEditReason" class="ok-text">你是本管段养护工且该井未办结，可改动井盖状况与井深。</p>
      <p v-else class="error-text">{{ canEditReason }}</p>

      <section class="audit-panel">
        <header class="audit-head">
          <h3>本井责任留痕</h3>
        </header>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>养护工</th><th>关口</th><th>动作</th><th>结果</th><th>详情</th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in recordAudits" :key="entry.id">
              <td>{{ formatTime(entry.time) }}</td>
              <td>{{ entry.actorName }}<span class="muted-text">（{{ entry.actorSegment }}）</span></td>
              <td>{{ entry.stage }}</td>
              <td>{{ entry.action }}</td>
              <td><span :class="['badge', entry.result === '通过' ? 'own' : 'reject']">{{ entry.result }}</span></td>
              <td>{{ entry.detail }}</td>
            </tr>
            <tr v-if="!recordAudits.length">
              <td colspan="6" class="empty-state">本井暂无留痕</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <div v-if="editOpen && record" class="modal-mask" @click.self="editOpen = false">
      <div class="modal-panel">
        <h3>改动检查井（{{ String(record[CODE_FIELD]) }}）</h3>
        <p class="modal-sub">只能改井盖状况与井深；依据版本 v{{ editForm.expectedVersion }}，井体状态会同笔重算。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>井盖状况 *</span>
            <select v-model="editForm.cover">
              <option v-for="value in coverValues" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>井深(米) *</span>
            <input v-model.number="editForm.depth" type="number" step="0.1" :min="0.2" :max="30" />
          </label>
        </div>
        <p v-if="editError" class="error-text form-error">{{ editError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">提交改动</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getManhole, listManholeAudits, updateManhole } from '@/api/manhole-service'
import {
  BODY_FIELD,
  CODE_FIELD,
  COVER_FIELD,
  COVER_VALUES,
  DEPTH_FIELD,
  FINISHED_STATUS,
  INSPECT_DATE_FIELD,
  INSPECTOR_FIELD,
  MEASURE_FIELD,
  TIER_LABEL,
  belongsTo,
  isFinished,
  segmentNameOf,
  type ArchiveTier,
  type CoverValue,
  type ManholeAuditEntry,
  type ManholeRecord,
} from '@/data/manhole-domain'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()

const coverValues = COVER_VALUES as readonly CoverValue[]
const id = Number(route.params.id)
const record = ref<ManholeRecord | undefined>(undefined)

function load() {
  record.value = getManhole(id)
}
onMounted(load)

const owner = computed(() => (record.value ? belongsTo(record.value, store.currentCrew) : false))

const canEditReason = computed(() => {
  if (!record.value) {
    return ''
  }
  if (isFinished(record.value)) {
    return `井「${String(record.value[CODE_FIELD])}」已养护办结，整条受控只读，任何人不能再改。`
  }
  if (!owner.value) {
    return `井「${String(record.value[CODE_FIELD])}」归属 ${segmentNameOf(record.value.segmentCode)}，你所在身份不能跨管段改动，提交会在【归属】关口退回。`
  }
  return ''
})

const canEdit = computed(() => Boolean(record.value) && !canEditReason.value)

const recordAudits = computed<ManholeAuditEntry[]>(() => {
  if (!record.value) {
    return []
  }
  const label = `${segmentNameOf(record.value.segmentCode)} / ${String(record.value[CODE_FIELD])}`
  const code = String(record.value[CODE_FIELD])
  return listManholeAudits()
    .filter((entry) => entry.target === label || entry.detail.includes(code))
    .slice(0, 20)
})

const editOpen = ref(false)
const editError = ref('')
const editForm = reactive({ cover: '完好' as CoverValue, depth: 3, expectedVersion: 1 })

function openEdit() {
  if (!record.value || !canEdit.value) {
    return
  }
  editForm.cover = String(record.value[COVER_FIELD]) as CoverValue
  editForm.depth = Number(record.value[DEPTH_FIELD])
  editForm.expectedVersion = record.value.version
  editError.value = ''
  editOpen.value = true
}

function submitEdit() {
  const result = updateManhole(store.operatorId, {
    id,
    cover: editForm.cover,
    depth: Number(editForm.depth),
    expectedVersion: editForm.expectedVersion,
  })
  if (!result.ok) {
    editError.value = result.message
    return
  }
  editOpen.value = false
  load()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (num: number) => `${num}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>
