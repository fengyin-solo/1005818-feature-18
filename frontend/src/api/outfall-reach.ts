import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 排口巡查「按河段收敛」的专用逻辑：聚合、排序、空检索诊断、向防涝预警待拟清单推送，
// 都集中在这里，页面只负责展示。字段名与 modules.ts 里 outfallpatrol 的 fields 对齐。

const CODE_FIELD = '巡查编号'
const OUTFALL_FIELD = '排口名称'
const REACH_FIELD = '所在河段'
const QUALITY_FIELD = '排放水质'
const PROBLEM_FIELD = '发现问题数'
const DATE_FIELD = '巡查日期'
const OPERATOR_FIELD = '巡查人'
// 推到防涝预警时写在预警单上的回溯字段，用来挡住重复推送。
const SOURCE_FIELD = '来源巡查编号'

export type SortDir = 'asc' | 'desc'

export type OutfallSummary = {
  name: string
  reach: string
  totalProblems: number
  patrolTimes: number
  duplicates: number
  chain: string[]
  repeated: boolean
  quality: string
  compliant: boolean
  overStandard: boolean
  records: EntryRow[]
}

export type ReachGroup = {
  reach: string
  outfalls: OutfallSummary[]
  totalProblems: number
  overStandardCount: number
}

export function problemCountOf(row: EntryRow): number {
  const value = Number(row[PROBLEM_FIELD])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function isOverStandardQuality(value: unknown): boolean {
  const text = String(value ?? '')
  return text.includes('超标') || text.includes('不达标')
}

export function isCompliantQuality(value: unknown): boolean {
  const text = String(value ?? '')
  return text.includes('达标') && !isOverStandardQuality(text)
}

function recordOrder(row: EntryRow): string {
  return `${String(row[DATE_FIELD] ?? '')}#${String(row.id).padStart(8, '0')}`
}

// 把同一河段上同一排口的巡查记录攒成一条汇总。
// 重复提交的巡查编号只记一次：编号去重后再累计问题数、串编号链。
export function summarizeOutfalls(rows: EntryRow[]): OutfallSummary[] {
  const buckets = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = `${String(row[REACH_FIELD] ?? '')}::${String(row[OUTFALL_FIELD] ?? '')}`
    const bucket = buckets.get(key) ?? []
    bucket.push(row)
    buckets.set(key, bucket)
  }
  const summaries: OutfallSummary[] = []
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => recordOrder(a).localeCompare(recordOrder(b)))
    const seen = new Set<string>()
    const unique: EntryRow[] = []
    for (const row of ordered) {
      const code = String(row[CODE_FIELD] ?? '')
      if (seen.has(code)) {
        continue
      }
      seen.add(code)
      unique.push(row)
    }
    const first = unique[0]
    const qualities = unique.map((row) => String(row[QUALITY_FIELD] ?? ''))
    const overRow = unique.find((row) => isOverStandardQuality(row[QUALITY_FIELD]))
    summaries.push({
      name: String(first?.[OUTFALL_FIELD] ?? ''),
      reach: String(first?.[REACH_FIELD] ?? ''),
      totalProblems: unique.reduce((sum, row) => sum + problemCountOf(row), 0),
      patrolTimes: unique.length,
      duplicates: bucket.length - unique.length,
      chain: unique.map((row) => String(row[CODE_FIELD] ?? '')),
      repeated: unique.filter((row) => problemCountOf(row) > 0).length >= 2,
      quality: overRow ? String(overRow[QUALITY_FIELD]) : qualities[qualities.length - 1] ?? '',
      compliant: qualities.length > 0 && qualities.every((item) => isCompliantQuality(item)),
      overStandard: Boolean(overRow),
      records: unique,
    })
  }
  return summaries
}

// 按所在河段收敛：段内排口按累计问题数排序、水质达标的压到后面；河段之间问题多的先看。
export function buildReachView(
  rows: EntryRow[],
  filters: Record<string, string>,
  sortDir: SortDir,
): ReachGroup[] {
  const matched = filterRows(rows, filters)
  const summaries = summarizeOutfalls(matched)
  const direction = sortDir === 'asc' ? 1 : -1
  summaries.sort((a, b) => {
    if (a.compliant !== b.compliant) {
      return a.compliant ? 1 : -1
    }
    if (a.totalProblems !== b.totalProblems) {
      return (a.totalProblems - b.totalProblems) * direction
    }
    return a.name.localeCompare(b.name, 'zh')
  })
  const groups = new Map<string, ReachGroup>()
  for (const summary of summaries) {
    const group =
      groups.get(summary.reach) ??
      ({ reach: summary.reach, outfalls: [], totalProblems: 0, overStandardCount: 0 } as ReachGroup)
    group.outfalls.push(summary)
    group.totalProblems += summary.totalProblems
    if (summary.overStandard) {
      group.overStandardCount += 1
    }
    groups.set(summary.reach, group)
  }
  return [...groups.values()].sort(
    (a, b) => b.totalProblems - a.totalProblems || a.reach.localeCompare(b.reach, 'zh'),
  )
}

// 叠加检索查空了时，说明哪一格填得有问题：
// 先看哪一格单独就匹配不到；都能匹配时，找出叠加到哪一格开始一条不剩。
export function diagnoseEmptyFilters(rows: EntryRow[], filters: Record<string, string>): string {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return ''
  }
  const misses = pairs.filter(
    ([field, value]) => !rows.some((row) => String(row[field] ?? '').includes(value.trim())),
  )
  if (misses.length > 0) {
    const fields = misses.map(([field]) => `「${field}」`).join('、')
    return `没有查到记录：${fields}这一格填的内容匹配不到任何排口巡查记录，请核对后重填`
  }
  let current = rows
  for (const [field, value] of pairs) {
    current = current.filter((row) => String(row[field] ?? '').includes(value.trim()))
    if (current.length === 0) {
      return `没有查到记录：每一格单独都能查到，但叠加到「${field}」后一条都不剩，请检查这一格是否与其他条件填串了`
    }
  }
  return ''
}

// 取排口最近一次水质超标的巡查记录，作为推送防涝预警的依据。
export function latestOverStandardRecord(summary: OutfallSummary): EntryRow | null {
  const hits = summary.records.filter((row) => isOverStandardQuality(row[QUALITY_FIELD]))
  return hits.length > 0 ? hits[hits.length - 1] : null
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function pushConclusion(record: EntryRow, basis: string, level: string): ActionResult {
  const code = String(record[CODE_FIELD] ?? '')
  const rows = listRows('floodwarn')
  if (rows.some((row) => String(row[SOURCE_FIELD] ?? '') === code)) {
    return { ok: false, message: `巡查编号 ${code} 已在防涝预警待拟清单里，重复编号只记一次` }
  }
  const id = nextId(rows)
  const warnCode = `WARN-${String(id).padStart(4, '0')}`
  const row: EntryRow = {
    id,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    预警编号: warnCode,
    预警级别: level,
    影响区域: String(record[REACH_FIELD] ?? ''),
    预警依据: basis,
    拟稿人: String(record[OPERATOR_FIELD] ?? '排口巡查'),
    发布时间: '',
    解除时间: '',
    预警状态: '待拟稿',
    [SOURCE_FIELD]: code,
  }
  saveRows('floodwarn', [...rows, row])
  return { ok: true, message: `已落到防涝预警待拟清单（${warnCode}）` }
}

// 水质超标的巡查记录 → 防涝预警待拟清单。
export function pushOverStandard(record: EntryRow): ActionResult {
  const basis = `水质超标：${record[OUTFALL_FIELD]}（${record[REACH_FIELD]}）排放水质${record[QUALITY_FIELD]}，本次发现问题${problemCountOf(record)}个，巡查编号${record[CODE_FIELD]}`
  return pushConclusion(record, basis, '橙色')
}

// 巡查办结的结论 → 防涝预警待拟清单。
export function settlePatrol(record: EntryRow): ActionResult {
  const basis = `巡查办结：${record[OUTFALL_FIELD]}（${record[REACH_FIELD]}）本次发现问题${problemCountOf(record)}个，排放水质${record[QUALITY_FIELD]}，巡查编号${record[CODE_FIELD]}`
  const level = isOverStandardQuality(record[QUALITY_FIELD])
    ? '橙色'
    : problemCountOf(record) > 0
      ? '黄色'
      : '蓝色'
  return pushConclusion(record, basis, level)
}
