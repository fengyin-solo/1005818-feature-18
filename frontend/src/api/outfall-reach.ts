import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 排口巡查的「按河段收敛」视图：把散在河段上的巡查记录按所在河段攒起来，
// 同一排口累计问题数、把反复出现问题的巡查编号串成链，超标水质可以推到防涝预警待拟清单。

const SOURCE_KEY = 'outfallpatrol'
const WARN_KEY = 'floodwarn'

export type ReachFilters = {
  巡查编号: string
  所在河段: string
  排放水质: string
}

export type OutfallAggregate = {
  排口名称: string
  累计问题数: number
  排放水质: string
  达标: boolean
  超标: boolean
  巡查编号链: string[]
  反复出现: boolean
}

export type ReachGroup = {
  所在河段: string
  累计问题数: number
  排口: OutfallAggregate[]
}

export type ReachPage = {
  groups: ReachGroup[]
  totalGroups: number
  page: number
  pageCount: number
  emptyHints: string[]
}

export type PushResult = {
  ok: boolean
  message: string
}

function problemCount(row: EntryRow): number {
  const parsed = Number.parseInt(String(row['发现问题数'] ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function isExceeded(text: string): boolean {
  return text.includes('超标') || text.includes('不达标')
}

function isUpToStandard(text: string): boolean {
  return text.includes('达标') && !isExceeded(text)
}

// 同一条河段上的同一个排口被重复提交巡查时，重复编号只记一次。
export function dedupeOutfallRows(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  for (const row of rows) {
    const key = [row['所在河段'], row['排口名称'], row['巡查编号']].map((v) => String(v ?? '')).join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    kept.push(row)
  }
  return kept
}

function applyFilters(rows: EntryRow[], filters: ReachFilters): EntryRow[] {
  const pairs = (Object.entries(filters) as [keyof ReachFilters, string][]).filter(
    ([, value]) => value.trim() !== '',
  )
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 检索空了的时候说明哪一格填得有问题：逐格回检，哪一格单独都命中不了就点出来。
function diagnoseEmpty(filters: ReachFilters, rows: EntryRow[]): string[] {
  const pairs = (Object.entries(filters) as [keyof ReachFilters, string][]).filter(
    ([, value]) => value.trim() !== '',
  )
  if (pairs.length === 0) {
    return ['当前没有任何巡查记录，请先在排口巡查里登记']
  }
  const hints: string[] = []
  for (const [field, value] of pairs) {
    const hit = rows.some((row) => String(row[field] ?? '').includes(value.trim()))
    if (!hit) {
      hints.push(`「${field}」填的是「${value.trim()}」，所有巡查记录里都没有这一项，检查这一格是不是填错了`)
    }
  }
  if (hints.length === 0) {
    hints.push('每一格单独都能命中，但叠加起来没有交集，放宽其中一格再查')
  }
  return hints
}

function aggregate(rows: EntryRow[]): ReachGroup[] {
  const byReach = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const reach = String(row['所在河段'] ?? '') || '未填河段'
    const list = byReach.get(reach) ?? []
    list.push(row)
    byReach.set(reach, list)
  }
  const groups: ReachGroup[] = []
  for (const [reach, reachRows] of byReach) {
    const byOutfall = new Map<string, EntryRow[]>()
    for (const row of reachRows) {
      const name = String(row['排口名称'] ?? '') || '未填排口'
      const list = byOutfall.get(name) ?? []
      list.push(row)
      byOutfall.set(name, list)
    }
    const outfalls: OutfallAggregate[] = [...byOutfall.entries()].map(([name, list]) => {
      const codes = [...new Set(list.map((row) => String(row['巡查编号'] ?? '')).filter(Boolean))]
      const quality = String(list[list.length - 1]['排放水质'] ?? '')
      return {
        排口名称: name,
        累计问题数: list.reduce((sum, row) => sum + problemCount(row), 0),
        排放水质: quality,
        达标: isUpToStandard(quality),
        超标: isExceeded(quality),
        巡查编号链: codes,
        反复出现: codes.length > 1,
      }
    })
    // 问题数多的排前面，水质达标的压到后面。
    outfalls.sort((a, b) => {
      if (a.达标 !== b.达标) {
        return a.达标 ? 1 : -1
      }
      return b.累计问题数 - a.累计问题数
    })
    groups.push({
      所在河段: reach,
      累计问题数: outfalls.reduce((sum, item) => sum + item.累计问题数, 0),
      排口: outfalls,
    })
  }
  return groups
}

export function buildReachPage(
  filters: ReachFilters,
  page: number,
  pageSize: number,
  sortDesc: boolean,
): ReachPage {
  const deduped = dedupeOutfallRows(listRows(SOURCE_KEY))
  const matched = applyFilters(deduped, filters)
  const groups = aggregate(matched)
  groups.sort((a, b) => (sortDesc ? b.累计问题数 - a.累计问题数 : a.累计问题数 - b.累计问题数))
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  return {
    groups: groups.slice((safePage - 1) * pageSize, safePage * pageSize),
    totalGroups: groups.length,
    page: safePage,
    pageCount,
    emptyHints: matched.length === 0 ? diagnoseEmpty(filters, deduped) : [],
  }
}

// 巡查状态为「已上报」的收在单独一处。
export function listReportedRows(): EntryRow[] {
  return dedupeOutfallRows(listRows(SOURCE_KEY)).filter((row) => String(row.status) === '已上报')
}

function nextWarnId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function appendWarnDraft(fields: Record<string, string>, dedupeKey: string): PushResult {
  const rows = listRows(WARN_KEY)
  const duplicated = rows.some(
    (row) => String(row.status) === '待拟稿' && String(row['预警依据'] ?? '').includes(dedupeKey),
  )
  if (duplicated) {
    return { ok: false, message: `防涝预警待拟清单里已有「${dedupeKey}」对应的一条，不重复登记` }
  }
  const id = nextWarnId(rows)
  const row: EntryRow = {
    id,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    预警编号: `WARN-${String(id).padStart(4, '0')}`,
    预警级别: '关注',
    影响区域: fields['影响区域'] ?? '',
    预警依据: fields['预警依据'] ?? '',
    拟稿人: '',
    发布时间: '',
    解除时间: '',
    预警状态: '待拟稿',
  }
  saveRows(WARN_KEY, [...rows, row])
  return { ok: true, message: `已推到防涝预警待拟清单（${String(row['预警编号'])}）` }
}

// 水质超标的排口推到防涝预警的待拟清单。
export function pushExceededToWarn(reach: string, outfall: OutfallAggregate): PushResult {
  return appendWarnDraft(
    {
      影响区域: reach,
      预警依据: `排口「${outfall.排口名称}」排放水质${outfall.排放水质}，累计问题${outfall.累计问题数}个（巡查编号：${outfall.巡查编号链.join('→')}）`,
    },
    `排口「${outfall.排口名称}」`,
  )
}

// 巡查办结的结论落到防涝预警的待拟清单。
export function pushConclusionToWarn(row: EntryRow): PushResult {
  const code = String(row['巡查编号'] ?? '')
  return appendWarnDraft(
    {
      影响区域: String(row['所在河段'] ?? ''),
      预警依据: `巡查办结结论（${code}）：排口「${String(row['排口名称'] ?? '')}」发现问题${problemCount(row)}个，排放水质${String(row['排放水质'] ?? '')}`,
    },
    `巡查办结结论（${code}）`,
  )
}
