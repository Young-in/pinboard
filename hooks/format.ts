// Pure display helpers for the pane: terminal cell widths, truncation, short times.
import type { PinboardKind } from '../types'

/** Cells a code point takes in a terminal: 2 for wide East Asian characters and emoji, 0 for combining marks. */
export function cellWidth(codePoint: number): number {
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  )
    return 0
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
    return 2
  return 1
}

/** Cells a string takes in a terminal. */
export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += cellWidth(ch.codePointAt(0) ?? 0)
  return w
}

/** Cuts `text` to at most `cells` cells, ending in `…` when it was cut. */
export function fitWidth(text: string, cells: number): string {
  if (cells <= 0) return ''
  if (textWidth(text) <= cells) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = cellWidth(ch.codePointAt(0) ?? 0)
    if (w + cw > cells - 1) break
    out += ch
    w += cw
  }
  return `${out.trimEnd()}…`
}

/** A compact age for a list column: 방금, 5분, 3시간, 2일, or the date as MM-DD. */
export function shortAge(now: number, then: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return '방금'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}일`
  const date = new Date(then)
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Local date and time as YYYY-MM-DD HH:MM. */
export function localStamp(then: number): string {
  const d = new Date(then)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export const KIND_LABEL: Record<PinboardKind, string> = { table: '표', artifact: '아티팩트', link: '링크', text: '메모' }
