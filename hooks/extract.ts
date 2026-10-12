// Pure helpers: find markdown tables and links in a reply, name them, classify text.
import type { PinboardKind } from '../types'

export type Extracted = { kind: PinboardKind; title: string; body: string }

export const MAX_TITLE = 60

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/
const URL = /https?:\/\/[^\s<>()[\]'"`]+/g
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const ARTIFACT = /claude\.ai\/(?:code\/)?artifact\//

export function cleanTitle(line: string): string {
  return line
    .replace(/^[#>\-*\d.)\s]+/, '')
    .replace(/[*_`]/g, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .slice(0, MAX_TITLE)
}

function isTableLine(line: string): boolean {
  const t = line.trim()
  return t.length > 0 && t.includes('|')
}

export function headerCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
    .filter(Boolean)
}

export function extractTables(text: string): Extracted[] {
  const lines = text.split('\n')
  const out: Extracted[] = []
  let i = 0
  while (i < lines.length - 1) {
    const header = lines[i] ?? ''
    const sep = lines[i + 1] ?? ''
    if (isTableLine(header) && SEPARATOR.test(sep)) {
      let end = i + 2
      while (end < lines.length && isTableLine(lines[end] ?? '')) end++
      const body = lines.slice(i, end).join('\n').trim()
      let title = ''
      for (let j = i - 1; j >= 0; j--) {
        const above = (lines[j] ?? '').trim()
        if (!above) continue
        if (isTableLine(above) || SEPARATOR.test(above)) break
        // A heading, a short label or a line ending in a colon names the table; a long sentence does not.
        if (above.length <= 48 || /^#/.test(above) || /[:：]$/.test(above)) title = cleanTitle(above)
        break
      }
      if (!title) title = headerCells(header).join(' | ').slice(0, MAX_TITLE)
      out.push({ kind: 'table', title: title || '표', body })
      i = end
    } else {
      i++
    }
  }
  return out
}

export function extractLinks(text: string, onlyArtifacts: boolean): Extracted[] {
  const labels = new Map<string, string>()
  for (const m of text.matchAll(MD_LINK)) labels.set(m[2] ?? '', m[1] ?? '')
  const out: Extracted[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(URL)) {
    const url = (m[0] ?? '').replace(/[.,;:!?*]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    const isArtifact = ARTIFACT.test(url)
    if (onlyArtifacts && !isArtifact) continue
    const label = cleanTitle(labels.get(url) ?? '')
    const fallback = isArtifact
      ? `artifact ${url.split('/').filter(Boolean).pop() ?? ''}`
      : url.replace(/^https?:\/\//, '')
    out.push({ kind: isArtifact ? 'artifact' : 'link', title: (label || fallback).slice(0, MAX_TITLE), body: url })
  }
  return out
}

/** Tables and artifact links: what /pin and the candidate list pick up by default. */
export function extractAll(text: string): Extracted[] {
  return [...extractTables(text), ...extractLinks(text, true)]
}

export function firstLineTitle(text: string, fallback = '메모'): string {
  for (const line of text.split('\n')) {
    const t = cleanTitle(line)
    if (t) return t
  }
  return fallback
}

export function classify(text: string): PinboardKind {
  const t = text.trim()
  if (/^https?:\/\/\S+$/.test(t)) return ARTIFACT.test(t) ? 'artifact' : 'link'
  if (extractTables(t).length > 0) return 'table'
  return 'text'
}

export function isKind(value: unknown): value is PinboardKind {
  return value === 'table' || value === 'artifact' || value === 'link' || value === 'text'
}

export function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

/** Whitespace-insensitive identity of a body, for de-duplication. */
export function bodyKey(body: string): string {
  return body.replace(/\s+/g, ' ').trim()
}
