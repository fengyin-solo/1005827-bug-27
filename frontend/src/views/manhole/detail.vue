<template>
  <section class="page" data-module="manhole-detail">
    <header class="page-head">
      <div>
        <h2>
          检查井详情
          <span v-if="well" class="detail-code">#{{ well.id }} · {{ well.code }}</span>
          <span v-if="well?.legacySegment" class="tag tag-legacy">老档</span>
          <span v-if="well?.locked" class="tag tag-locked">办结只读</span>
        </h2>
        <p class="page-desc">归属只认所属管段；井盖状况、井深仅本管段养护工可改；井体状态按井盖状况由服务统一核定。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/manhole">返回列表</RouterLink>
        <button class="btn" type="button" @click="reload">刷新（重读最新版本）</button>
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
        <template v-if="well && canEdit">本管段责任人身份：可改井盖状况与井深，提交时带版本号做并发校验。</template>
        <template v-else-if="well && well.locked">该井已养护办结，整条受控只读。</template>
        <template v-else-if="well">该井归属管段「{{ well.segment }}」，责任人 {{ well.ownerCaretaker }}，当前身份跨管段，改动会被退回。</template>
      </p>
    </div>

    <div v-if="!well" class="detail-missing">
      <p class="error-text">没有找到这口检查井，可能已被重置或编号有误。</p>
      <RouterLink class="btn primary" to="/manhole">回到列表</RouterLink>
    </div>

    <template v-else>
      <div class="detail-grid">
        <article class="detail-card">
          <h3>井档信息</h3>
          <dl class="detail-list">
            <div><dt>井编号</dt><dd>{{ well.code }}</dd></div>
            <div>
              <dt>所属管段</dt>
              <dd>
                {{ well.segment }}
                <span v-if="well.legacySegment" class="tag tag-legacy">既有层级保留</span>
              </dd>
            </div>
            <div><dt>管段责任人</dt><dd>{{ well.ownerCaretaker }}</dd></div>
            <div><dt>检查人</dt><dd>{{ well.inspector || '—' }}</dd></div>
            <div><dt>检查日期</dt><dd>{{ well.inspectDate || '—' }}</dd></div>
            <div><dt>养护措施</dt><dd>{{ well.measure || '—' }}</dd></div>
            <div><dt>当前状态</dt><dd>{{ well.status }}（版本 v{{ well.version }}）</dd></div>
          </dl>
        </article>

        <article class="detail-card">
          <h3>受控字段</h3>
          <dl class="detail-list">
            <div><dt>井盖状况</dt><dd>{{ well.cover }}</dd></div>
            <div><dt>井深</dt><dd>{{ well.depth }}{{ well.depth ? ' 米' : '' }}</dd></div>
            <div><dt>井体状态（按井盖状况核定）</dt><dd>{{ well.body }}</dd></div>
          </dl>
          <p class="modal-hint">井体状态不接受手工填写：井盖状况一改，井体状态由服务随改动重算，列表与详情同源。</p>
        </article>
      </div>

      <div class="detail-grid">
        <article class="detail-card">
          <h3>养护改动（井盖状况 / 井深）</h3>
          <form v-if="canEdit" class="edit-form" @submit.prevent="submitUpdate">
            <label class="form-item">
              <span>井盖状况</span>
              <select v-model="editForm.cover">
                <option v-for="cover in coverStatuses" :key="cover" :value="cover">{{ cover }}</option>
              </select>
            </label>
            <label class="form-item">
              <span>井深（米）</span>
              <input v-model="editForm.depth" inputmode="decimal" />
            </label>
            <input type="hidden" :value="well.version" />
            <p class="modal-hint">提交基准版本 v{{ well.version }}；若期间已被别人先改，本次按并发冲突挡回，只认先到版本。</p>
            <p v-if="updateMessage" :class="updateOk ? 'success-text' : 'error-text'">{{ updateMessage }}</p>
            <div class="modal-actions">
              <button class="btn primary" type="submit">提交改动</button>
            </div>
          </form>
          <p v-else-if="well.locked" class="error-text">已养护办结，整条记录受控只读。</p>
          <p v-else class="error-text">跨管段身份：只有本管段「{{ well.segment }}」责任人 {{ well.ownerCaretaker }} 能改，提交会被归属校验退回并留痕。</p>
        </article>

        <article class="detail-card">
          <h3>养护流转</h3>
          <div class="action-stack">
            <button
              v-for="action in actions"
              :key="action"
              class="btn"
              type="button"
              :disabled="well.locked"
              @click="runAction(action)"
            >
              {{ action }}
            </button>
          </div>
          <p v-if="actionMessage" :class="actionOk ? 'success-text' : 'error-text'">{{ actionMessage }}</p>
          <p v-if="well.locked" class="modal-hint">办结后全部动作停用。</p>
        </article>

        <article class="detail-card">
          <h3>归属调整（仅值班管理员）</h3>
          <form v-if="session.actor.admin" class="edit-form" @submit.prevent="submitReassign">
            <label class="form-item">
              <span>调整到管段</span>
              <select v-model="reassignSegmentCode">
                <option
                  v-for="seg in availableReassignSegments"
                  :key="seg.code"
                  :value="seg.code"
                >
                  {{ seg.name }}（责任人 {{ seg.caretaker }}）
                </option>
              </select>
            </label>
            <p class="modal-hint">调整后按新归属把目标管段所有井的井体状态重算一次；办结井不可调整、重算时跳过。</p>
            <p v-if="reassignMessage" :class="reassignOk ? 'success-text' : 'error-text'">{{ reassignMessage }}</p>
            <div class="modal-actions">
              <button class="btn primary" type="submit" :disabled="well.locked">执行归属调整</button>
            </div>
          </form>
          <p v-else class="error-text">归属调整仅值班管理员可用，养护工跨管段认领一律退回。</p>
        </article>
      </div>

      <div class="audit-panel">
        <h3>本井养护留痕</h3>
        <table class="data-table audit-table">
          <thead>
            <tr><th>时间</th><th>操作人</th><th>动作</th><th>结果</th><th>环节</th><th>说明</th><th>版本</th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in history" :key="entry.id" :class="{ 'row-blocked': !entry.ok }">
              <td>{{ formatTime(entry.at) }}</td>
              <td>{{ entry.actor }}</td>
              <td>{{ entry.action }}</td>
              <td><span :class="entry.ok ? 'success-text' : 'error-text'">{{ entry.ok ? '通过' : '退回' }}</span></td>
              <td>{{ entry.gate }}</td>
              <td>{{ entry.detail }}</td>
              <td>{{ entry.fromVersion ?? '—' }} → {{ entry.toVersion ?? '—' }}</td>
            </tr>
            <tr v-if="!history.length">
              <td colspan="7" class="empty-state">暂无这口井的留痕</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  getManhole,
  manholeHistory,
  reassignSegment,
  runManholeAction,
  updateManhole,
} from '@/data/manhole/manhole-service'
import { actorByName, SEGMENTS } from '@/data/manhole/segments'
import { COVER_STATUS, type Actor, type AuditEntry, type ManholeView } from '@/data/manhole/types'
import { useManholeSession } from '@/stores/manhole-session'

const props = defineProps<{ id: string }>()

const session = useManholeSession()
const actions = ['提交检查', '确认养护', '提出维修']
const coverStatuses = [...COVER_STATUS]

const well = ref<ManholeView | null>(null)
const history = ref<AuditEntry[]>([])

const editForm = ref({ cover: '完好', depth: '' })
const updateMessage = ref('')
const updateOk = ref(false)
const actionMessage = ref('')
const actionOk = ref(false)
const reassignSegmentCode = ref('')
const reassignMessage = ref('')
const reassignOk = ref(false)

const canEdit = computed(
  () =>
    !!well.value &&
    !well.value.locked &&
    !session.actor.admin &&
    session.canOwnSegment(well.value.segment),
)

const availableReassignSegments = computed(() =>
  SEGMENTS.filter((seg) => seg.code !== well.value?.segment),
)

watch(
  well,
  (value) => {
    if (value) {
      editForm.value = { cover: value.cover, depth: value.depth }
      reassignSegmentCode.value =
        SEGMENTS.find((seg) => seg.code !== value.segment)?.code ?? ''
    }
  },
  { immediate: true },
)

function onSwitchActor(event: Event) {
  session.setActor((event.target as HTMLSelectElement).value)
  updateMessage.value = ''
  actionMessage.value = ''
}

function syncEditForm() {
  if (well.value) {
    editForm.value = { cover: well.value.cover, depth: well.value.depth }
  }
}

function submitUpdate() {
  if (!well.value) {
    return
  }
  // 详情打开时持有版本号；冲突时返回存储里的最新版本，表单回显先到那一版。
  const result = updateManhole(session.actor as Actor, well.value.id, {
    cover: editForm.value.cover,
    depth: editForm.value.depth,
    expectedVersion: well.value.version,
  })
  updateOk.value = result.ok
  updateMessage.value = result.message
  if (!result.ok && result.current) {
    well.value = result.current
    syncEditForm()
  }
  reload()
}

function runAction(action: string) {
  if (!well.value) {
    return
  }
  const result = runManholeAction(session.actor as Actor, well.value.id, action, well.value.version)
  actionOk.value = result.ok
  actionMessage.value = result.message
  if (!result.ok && result.current) {
    well.value = result.current
  }
  reload()
}

function submitReassign() {
  if (!well.value) {
    return
  }
  const result = reassignSegment(session.actor as Actor, well.value.id, reassignSegmentCode.value)
  reassignOk.value = result.ok
  reassignMessage.value = result.message
  reload()
}

function reload() {
  const id = Number(props.id)
  well.value = Number.isNaN(id) ? null : getManhole(id)
  history.value = Number.isNaN(id) ? [] : manholeHistory(id)
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
