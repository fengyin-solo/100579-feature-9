<template>
  <section class="page" data-module="settingcheck">
    <header class="page-head">
      <div>
        <h2>定值核对管理</h2>
        <p class="page-desc">维护核对记录，围绕核对编号、所属变电站、装置名称、现场定值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记核对记录</button>
        <button class="btn" type="button" @click="exportRows">导出定值核对清单</button>
      </div>
    </header>

    <div class="view-tabs" role="tablist">
      <button
        class="view-tab"
        :class="{ active: viewMode === 'board' }"
        type="button"
        @click="viewMode = 'board'"
      >
        核对单分栏视图
      </button>
      <button
        class="view-tab"
        :class="{ active: viewMode === 'list' }"
        type="button"
        @click="viewMode = 'list'"
      >
        定值核对清单
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="viewMode === 'board'">
      <div class="stat-row">
        <article v-for="item in boardStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="board-tip">
        结论只按现场实测值与台账定值比对判定；核对不符的核对单排在最前一栏，核对一致的收在末栏。
      </p>

      <div class="board-grid">
        <div v-for="station in board?.stations ?? []" :key="station.station" class="station-row">
          <h3 class="station-title">{{ station.station }}</h3>
          <div class="station-columns">
            <section
              v-for="column in boardColumns"
              :key="column.conclusion"
              class="board-column"
              :class="columnClass(column.conclusion)"
            >
              <header class="board-column-head">
                {{ column.title }}
                <span class="board-column-count">{{ station.columns[column.conclusion].length }}</span>
              </header>
              <div v-if="station.columns[column.conclusion].length" class="sheet-list">
                <article
                  v-for="sheet in station.columns[column.conclusion]"
                  :key="sheet.key"
                  class="sheet-card"
                  :class="{ 'is-signed': sheet.signed }"
                >
                  <header class="sheet-head">
                    <strong>{{ sheet.device }}</strong>
                    <span class="sheet-badge" :class="columnClass(sheet.conclusion)">
                      {{ sheet.conclusion }}
                    </span>
                  </header>
                  <dl class="sheet-items">
                    <template v-for="item in sheet.items" :key="String(item.id)">
                      <dt class="item-code">
                        {{ item['核对编号'] }}
                        <em class="item-verdict" :class="verdictClass(item)">
                          {{ verdictText(item) }}
                        </em>
                      </dt>
                      <dd class="item-values" :class="verdictClass(item)">
                        <span>现场定值：{{ item['现场定值'] || '—' }}</span>
                        <span>台账定值：{{ item['台账定值'] || '—' }}</span>
                      </dd>
                    </template>
                  </dl>
                  <footer class="sheet-sign">
                    <template v-if="sheet.signed">
                      <span class="signed-line">
                        核对人签字：<strong>{{ sheet.signer }}</strong>
                        <em class="signed-date">{{ sheet.signedAt }}</em>
                      </span>
                      <button class="link" type="button" @click="toggleSignForm(sheet.key)">重新签字</button>
                    </template>
                    <template v-else>
                      <span class="unsigned-line">核对人签字：待签字</span>
                      <button class="link" type="button" @click="toggleSignForm(sheet.key)">签字提交</button>
                    </template>
                    <form
                      v-if="signingKey === sheet.key"
                      class="sign-form"
                      @submit.prevent="submitSign(sheet)"
                    >
                      <label class="sign-name">
                        <span>核对人</span>
                        <input v-model="signerName" placeholder="沿用清单核对人" />
                      </label>
                      <button class="btn primary" type="submit">确认签字</button>
                      <button class="btn ghost" type="button" @click="signingKey = ''">取消</button>
                    </form>
                  </footer>
                </article>
              </div>
              <p v-else class="board-column-empty">—</p>
            </section>
          </div>
        </div>
        <p v-if="!board?.stations.length" class="empty-state board-empty">
          暂无条件匹配的核对记录，可先调整筛选或登记核对记录
        </p>
      </div>
    </div>

    <template v-else>
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

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
            <td :colspan="columns.length + 2" class="empty-state">暂无定值核对数据，可先登记核对记录</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>
        {{
          viewMode === 'board'
            ? `共 ${boardStats[2].value} 个变电站、${board?.sheets.length ?? 0} 张核对单`
            : `共 ${total} 条定值核对记录`
        }}
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  CHECK_COLUMNS,
  downloadEntries,
  itemVerdict,
  listEntries,
  loadCheckBoard,
  moduleMeta,
  runAction as applyAction,
  signCheckSheet,
} from '@/api/local-service'
import type { CheckBoard, CheckConclusion, CheckSheet, EntryRow } from '@/data/types'

const meta = moduleMeta('settingcheck')
const columns = ["核对编号", "所属变电站", "装置名称", "现场定值", "台账定值", "核对人", "核对日期", "核对状态"]
const actions = ["提交核对", "确认一致", "标记不符"]
const statuses = ["待核对", "核对中", "核对一致", "核对不符"]
const stats = [{"label": "待核对装置", "value": 0}, {"label": "核对一致装置", "value": 0}, {"label": "核对不符装置", "value": 0}]

const viewMode = ref<'board' | 'list'>('board')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const board = ref<CheckBoard | null>(null)
const boardColumns = CHECK_COLUMNS
const signingKey = ref('')
const signerName = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const boardStats = computed(() => {
  const sheets = board.value?.sheets ?? []
  return [
    { label: '核对不符核对单', value: sheets.filter((sheet) => sheet.conclusion === '核对不符').length },
    { label: '待出结论核对单', value: sheets.filter((sheet) => sheet.conclusion === '待出结论').length },
    { label: '变电站数', value: (board.value?.stations ?? []).length },
    { label: '核对一致核对单', value: sheets.filter((sheet) => sheet.conclusion === '核对一致').length },
  ]
})

function columnClass(conclusion: CheckConclusion | string): string {
  if (conclusion === '核对不符') {
    return 'verdict-mismatch'
  }
  if (conclusion === '核对一致') {
    return 'verdict-match'
  }
  return 'verdict-pending'
}

function verdictClass(row: EntryRow): string {
  const verdict = itemVerdict(row)
  if (verdict === 'mismatch') {
    return 'verdict-mismatch'
  }
  if (verdict === 'match') {
    return 'verdict-match'
  }
  return 'verdict-pending'
}

function verdictText(row: EntryRow): string {
  const verdict = itemVerdict(row)
  if (verdict === 'mismatch') {
    return '不符'
  }
  if (verdict === 'match') {
    return '一致'
  }
  return '待实测'
}

function toggleSignForm(key: string) {
  if (signingKey.value === key) {
    signingKey.value = ''
    return
  }
  const sheet = board.value?.sheets.find((item) => item.key === key)
  // 沿用既有核对口径：默认带出核对清单上该装置已有的核对人。
  const existingChecker = sheet?.items
    .map((item) => String(item['核对人'] ?? '').trim())
    .find((name) => name.length > 0 && !name.includes('样例'))
  signerName.value = existingChecker ?? sheet?.signer ?? ''
  signingKey.value = key
}

function submitSign(sheet: CheckSheet) {
  errorMessage.value = ''
  const result = signCheckSheet(sheet.key, signerName.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  signingKey.value = ''
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '核对记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    board.value = loadCheckBoard(filters.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值核对列表读取失败'
  }
}

onMounted(reload)
</script>
