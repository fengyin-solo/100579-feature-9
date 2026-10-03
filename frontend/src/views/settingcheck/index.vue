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

    <section class="board" aria-label="核对结论看板">
      <header class="board-head">
        <h3>核对结论看板</h3>
        <p class="board-desc">
          按所属变电站分行、核对结论分栏，核对不符排在最前一栏，核对一致收进末栏；结论只按现场实测值判定，与台账定值不一致即不符。
        </p>
      </header>
      <table class="data-table board-table">
        <thead>
          <tr>
            <th class="station-col">所属变电站</th>
            <th
              v-for="conclusion in board.conclusions"
              :key="conclusion"
              :class="conclusionClass(conclusion)"
            >
              {{ conclusion }}（{{ board.totals[conclusion] ?? 0 }}）
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="stationRow in board.rows" :key="stationRow.station">
            <th class="station-col">{{ stationRow.station }}</th>
            <td
              v-for="cell in stationRow.cells"
              :key="cell.conclusion"
              :class="conclusionClass(cell.conclusion)"
            >
              <article v-for="group in cell.groups" :key="group.device" class="device-group">
                <h4 class="device-name">{{ group.device }}</h4>
                <ul class="check-items">
                  <li v-for="item in group.items" :key="String(item.id)" class="check-item">
                    <span class="check-code">{{ item['核对编号'] }}</span>
                    <span>现场定值：{{ item['现场定值'] }}</span>
                    <span>台账定值：{{ item['台账定值'] }}</span>
                  </li>
                </ul>
                <p class="checker-sign">核对人签字：{{ group.checker }}</p>
              </article>
              <span v-if="!cell.groups.length" class="empty-cell">—</span>
            </td>
          </tr>
          <tr v-if="!board.rows.length">
            <td :colspan="board.conclusions.length + 1" class="empty-state">
              暂无定值核对数据，可先登记核对记录
            </td>
          </tr>
        </tbody>
      </table>
    </section>

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

    <footer class="page-foot">
      <span>共 {{ total }} 条定值核对记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  settingcheckBoard,
} from '@/api/local-service'
import type { EntryRow, SettingcheckBoard } from '@/data/types'

const meta = moduleMeta('settingcheck')
const columns = ["核对编号", "所属变电站", "装置名称", "现场定值", "台账定值", "核对人", "核对日期", "核对状态"]
const actions = ["提交核对", "确认一致", "标记不符"]
const statuses = ["待核对", "核对中", "核对一致", "核对不符"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const board = ref<SettingcheckBoard>({ conclusions: [], rows: [], totals: {} })
// 统计卡按核对结论实算：待出结论的算待核对，一致/不符以现场实测判定为准。
const stats = computed(() => [
  {
    label: '待核对装置',
    value: (board.value.totals['待核对'] ?? 0) + (board.value.totals['核对中'] ?? 0),
  },
  { label: '核对一致装置', value: board.value.totals['核对一致'] ?? 0 },
  { label: '核对不符装置', value: board.value.totals['核对不符'] ?? 0 },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function conclusionClass(conclusion: string) {
  return {
    'cell-mismatch': conclusion === '核对不符',
    'cell-consistent': conclusion === '核对一致',
  }
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
    board.value = settingcheckBoard()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定值核对列表读取失败'
  }
}

onMounted(reload)
</script>
