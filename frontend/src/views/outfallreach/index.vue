<template>
  <section class="page" data-module="outfallreach">
    <header class="page-head">
      <div>
        <h2>排口巡查 · 按河段收敛</h2>
        <p class="page-desc">
          把散在河段上的巡查记录按所在河段攒起来：同一排口累计问题数多的排前面，水质达标的压到后面；
          反复出问题的排口把历次巡查编号串起来回看，超标水质可推到防涝预警待拟清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="toggleSort">
          按问题数{{ sortDesc ? '降序' : '升序' }}（点击切换）
        </button>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索，可叠加`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="emptyHints.length" class="hint-box">
      <p>没有检索到符合条件的河段，问题出在：</p>
      <ul>
        <li v-for="hint in emptyHints" :key="hint">{{ hint }}</li>
      </ul>
    </div>

    <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>

    <article v-for="group in groups" :key="group.所在河段" class="reach-card">
      <header class="reach-head">
        <h3>{{ group.所在河段 }}</h3>
        <span class="reach-total">累计问题 {{ group.累计问题数 }} 个</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>排口名称</th>
            <th>累计问题数</th>
            <th>排放水质</th>
            <th>巡查编号回看</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in group.排口" :key="item.排口名称">
            <td>{{ item.排口名称 }}</td>
            <td>{{ item.累计问题数 }}</td>
            <td>
              <span :class="item.超标 ? 'quality-bad' : 'quality-ok'">{{ item.排放水质 || '—' }}</span>
            </td>
            <td>
              <span v-if="item.反复出现" class="code-chain" :title="'问题反复出现，历次巡查编号：' + item.巡查编号链.join(' → ')">
                {{ item.巡查编号链.join(' → ') }}
              </span>
              <span v-else>{{ item.巡查编号链.join('') || '—' }}</span>
            </td>
            <td>
              <button
                v-if="item.超标"
                class="link"
                type="button"
                @click="pushToWarn(group.所在河段, item)"
              >
                推到防涝预警待拟清单
              </button>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </article>

    <footer v-if="totalGroups > 0" class="page-foot pager">
      <button class="btn" type="button" :disabled="page <= 1" @click="turnPage(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ totalGroups }} 条河段</span>
      <button class="btn" type="button" :disabled="page >= pageCount" @click="turnPage(page + 1)">下一页</button>
    </footer>

    <section class="reported-box">
      <h3>已上报记录（单独归置）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in reportedColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reportedRows" :key="String(row.id)">
            <td v-for="column in reportedColumns" :key="column">{{ row[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!reportedRows.length">
            <td :colspan="reportedColumns.length" class="empty-state">暂无已上报的巡查记录</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import {
  buildReachPage,
  listReportedRows,
  pushExceededToWarn,
} from '@/api/outfall-reach'
import type { OutfallAggregate, ReachFilters, ReachGroup } from '@/api/outfall-reach'
import type { EntryRow } from '@/data/types'

const filterFields = ['巡查编号', '所在河段', '排放水质'] as const
const reportedColumns = ['巡查编号', '排口名称', '所在河段', '排放水质', '巡查人', '巡查日期', '发现问题数']
const pageSize = 3

const filters = reactive<ReachFilters>({ 巡查编号: '', 所在河段: '', 排放水质: '' })
const groups = ref<ReachGroup[]>([])
const reportedRows = ref<EntryRow[]>([])
const emptyHints = ref<string[]>([])
const noticeMessage = ref('')
const page = ref(1)
const pageCount = ref(1)
const totalGroups = ref(0)
const sortDesc = ref(true)

function reload() {
  const result = buildReachPage(filters, page.value, pageSize, sortDesc.value)
  groups.value = result.groups
  totalGroups.value = result.totalGroups
  page.value = result.page
  pageCount.value = result.pageCount
  emptyHints.value = result.emptyHints
  reportedRows.value = listReportedRows()
}

function applyFilters() {
  page.value = 1
  noticeMessage.value = ''
  reload()
}

function resetFilters() {
  filters.巡查编号 = ''
  filters.所在河段 = ''
  filters.排放水质 = ''
  applyFilters()
}

// 翻页只动页码，筛选条件留在原地不丢。
function turnPage(next: number) {
  page.value = next
  reload()
}

function toggleSort() {
  sortDesc.value = !sortDesc.value
  reload()
}

function pushToWarn(reach: string, item: OutfallAggregate) {
  const result = pushExceededToWarn(reach, item)
  noticeMessage.value = result.message
}

onMounted(reload)
</script>

<style scoped>
.hint-box {
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #9a3412;
}
.hint-box p { margin: 0 0 6px; }
.hint-box ul { margin: 0; padding-left: 18px; }
.notice-text { color: #1f6feb; font-size: 13px; }
.reach-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.reach-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.reach-head h3 { margin: 0; font-size: 15px; }
.reach-total { color: var(--muted); font-size: 12px; }
.code-chain { color: #b42318; font-weight: 600; }
.quality-bad { color: #b42318; font-weight: 600; }
.quality-ok { color: #15803d; }
.muted { color: var(--muted); }
.pager { align-items: center; gap: 12px; justify-content: center; }
.reported-box { margin-top: 20px; }
.reported-box h3 { font-size: 14px; margin: 0 0 8px; }
</style>
