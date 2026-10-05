<template>
  <section class="page" data-module="outfallpatrol">
    <header class="page-head">
      <div>
        <h2>排口巡查管理</h2>
        <p class="page-desc">
          按所在河段把排口收敛起来看：累计问题多的排口排前面、排放水质达标的压到后面；水质超标与巡查办结结论可落到防涝预警待拟清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排口巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出排口巡查清单</button>
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

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="draft[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>
    <p v-if="filterDiagnosis" class="error-text">{{ filterDiagnosis }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3 class="panel-title">按河段收敛</h3>
        <button class="btn ghost" type="button" @click="toggleSort">
          按问题数{{ sortDir === 'desc' ? '降序' : '升序' }}（点击切换）
        </button>
      </div>
      <article v-for="group in pagedGroups" :key="group.reach" class="reach-group">
        <header class="reach-group-head">
          <strong>{{ group.reach }}</strong>
          <span>排口 {{ group.outfalls.length }} 个</span>
          <span>累计问题 {{ group.totalProblems }} 个</span>
          <span v-if="group.overStandardCount">水质超标排口 {{ group.overStandardCount }} 个</span>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th>排口名称</th>
              <th>累计发现问题数</th>
              <th>巡查次数</th>
              <th>排放水质</th>
              <th>巡查编号链（问题反复出现可回看）</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="outfall in group.outfalls"
              :key="outfall.name"
              :class="{ 'row-compliant': outfall.compliant }"
            >
              <td>{{ outfall.name }}</td>
              <td>{{ outfall.totalProblems }}</td>
              <td>
                {{ outfall.patrolTimes }}
                <span v-if="outfall.duplicates" class="tag">重复提交已并掉 {{ outfall.duplicates }} 次</span>
              </td>
              <td>{{ outfall.quality || '—' }}</td>
              <td>
                <span>{{ outfall.chain.join(' → ') }}</span>
                <span v-if="outfall.repeated" class="tag warn">问题反复出现</span>
              </td>
              <td>
                <button
                  v-if="outfall.overStandard"
                  class="link"
                  type="button"
                  @click="pushWarn(outfall)"
                >
                  推到防涝预警待拟清单
                </button>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
      <p v-if="!pagedGroups.length" class="empty-state">没有符合当前条件的河段与排口</p>
      <div v-if="pageCount > 1" class="pager">
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">
          上一页
        </button>
        <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ reachGroups.length }} 个河段（翻页不清空筛选条件）</span>
        <button
          class="btn ghost"
          type="button"
          :disabled="page >= pageCount"
          @click="goPage(page + 1)"
        >
          下一页
        </button>
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">已上报记录（单独归集）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reportedRows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!reportedRows.length">
            <td :colspan="columns.length" class="empty-state">当前条件下没有已上报的巡查记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="panel-title">巡查记录明细</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detailRows" :key="String(row.id)">
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
          <tr v-if="!detailRows.length">
            <td :colspan="columns.length + 2" class="empty-state">
              暂无排口巡查数据，可先登记排口巡查记录
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条排口巡查记录</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  buildReachView,
  diagnoseEmptyFilters,
  latestOverStandardRecord,
  problemCountOf,
  pushOverStandard,
  settlePatrol,
} from '@/api/outfall-reach'
import type { OutfallSummary, SortDir } from '@/api/outfall-reach'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('outfallpatrol')
const columns = ["巡查编号", "排口名称", "所在河段", "排放水质", "巡查人", "巡查日期", "发现问题数", "巡查状态"]
const actions = ["提交巡查", "确认完成", "上报问题"]
const statuses = ["待巡查", "巡查中", "已完成", "已上报"]
// 巡查编号、所在河段、排放水质三格叠加检索。
const filterFields = ["巡查编号", "所在河段", "排放水质"]
const PAGE_SIZE = 2

const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const draft = ref<Record<string, string>>({})
const applied = ref<Record<string, string>>({})
const sortDir = ref<SortDir>('desc')
const page = ref(1)

const stats = computed(() => [
  { label: '待巡查排口', value: allRows.value.filter((row) => row.status === '待巡查').length },
  { label: '已完成巡查', value: allRows.value.filter((row) => row.status === '已完成').length },
  { label: '发现问题总数', value: allRows.value.reduce((sum, row) => sum + problemCountOf(row), 0) },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const filteredRows = computed(() => filterRows(allRows.value, applied.value))
// 巡查状态为已上报的收在单独一处，明细表里不再混着看。
const reportedRows = computed(() => filteredRows.value.filter((row) => row.status === '已上报'))
const detailRows = computed(() => filteredRows.value.filter((row) => row.status !== '已上报'))

const reachGroups = computed(() => buildReachView(allRows.value, applied.value, sortDir.value))
const pageCount = computed(() => Math.max(1, Math.ceil(reachGroups.value.length / PAGE_SIZE)))
const pagedGroups = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return reachGroups.value.slice(start, start + PAGE_SIZE)
})
const filterDiagnosis = computed(() =>
  reachGroups.value.length === 0 ? diagnoseEmptyFilters(allRows.value, applied.value) : '',
)

watch(pageCount, (count) => {
  if (page.value > count) {
    page.value = count
  }
})

function applyFilters() {
  applied.value = { ...draft.value }
  page.value = 1
}

function resetFilters() {
  draft.value = {}
  applied.value = {}
  page.value = 1
}

function toggleSort() {
  sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
}

function goPage(next: number) {
  if (next < 1 || next > pageCount.value) {
    return
  }
  // 只翻页，筛选条件留在 applied 里不丢。
  page.value = next
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排口巡查记录登记入口尚未接入审批流'
}

function pushWarn(outfall: OutfallSummary) {
  const record = latestOverStandardRecord(outfall)
  if (!record) {
    return
  }
  const result = pushOverStandard(record)
  if (result.ok) {
    notice.value = `${outfall.name}：${result.message}`
    errorMessage.value = ''
    return
  }
  errorMessage.value = result.message
  notice.value = ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  if (action === '确认完成') {
    // 巡查办结的结论落到防涝预警待拟清单；重复编号只记一次。
    const settle = settlePatrol(row)
    notice.value = `${result.message}；办结结论${settle.message}`
  } else {
    notice.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key)
    allRows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排口巡查列表读取失败'
  }
}

onMounted(reload)
</script>
