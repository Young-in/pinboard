// pinboard: pin tables, artifact links and answers from the conversation into a side pane.
//
// One module on purpose: the engine follows `$` only into functions declared in the file that
// registers the hooks, never across an import, so everything that touches `$` lives here, in
// sections. The markdown extraction is pure and lives in extract.ts.
//
// Entry points: /pin, /pins, /unpin; the model's pin/unpin/list tools; every reply scanned for
// tables and artifact links (candidates); the Pane the person opens.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInputOf, RenderSurface } from 'claude-code'

import type { PinboardCandidate, PinboardFilter, PinboardKind, PinboardPin } from '../types'
import {
  bodyKey,
  classify,
  cleanTitle,
  extractAll,
  extractLinks,
  extractTables,
  firstLineTitle,
  isKind,
  projectName,
  relativeTime,
} from './extract'
import { fitWidth, shortAge, textWidth } from './format'

// ────────────────────────────────────────────────────────────────────────────
// State, store and shared operations
// ────────────────────────────────────────────────────────────────────────────

type Dollar = EngineInterface
type PinInput = { kind: PinboardKind; title: string; body: string; sourceUuid?: string }

const PANE = 'pins'
const PANE_TITLE = 'Pins'
const STORE_PINS = 'pins'
const STORE_BACKUP = 'pins.backup'
const STORE_AUTO_OPEN = 'autoOpen'
const MAX_PINS = 200
const MAX_BODY = 20_000
const MAX_CANDIDATES = 8

const FILTERS: PinboardFilter[] = ['all', 'table', 'artifact', 'link', 'project']
const FILTER_LABEL: Record<PinboardFilter, string> = {
  all: '전체',
  table: '표',
  artifact: '아티팩트',
  link: '링크',
  project: '이 프로젝트',
}
const GLYPH: Record<PinboardKind, string> = { table: '▤', artifact: '◈', link: '⇗', text: '¶' }

const pins = atom({ plugin: 'pinboard', key: 'pins' } as const, [])
const selectedId = atom({ plugin: 'pinboard', key: 'selectedId' } as const, null)
const filter = atom({ plugin: 'pinboard', key: 'filter' } as const, 'all')
const candidates = atom({ plugin: 'pinboard', key: 'candidates' } as const, [])
const lastRemoved = atom({ plugin: 'pinboard', key: 'lastRemoved' } as const, null)
const confirmDeleteId = atom({ plugin: 'pinboard', key: 'confirmDeleteId' } as const, null)
const autoOpenSuppressed = atom({ plugin: 'pinboard', key: 'autoOpenSuppressed' } as const, false)

function newId(seed: number): string {
  return `${seed.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function visible(list: PinboardPin[], f: PinboardFilter, cwd: string): PinboardPin[] {
  if (f === 'all') return list
  if (f === 'project') return list.filter(p => p.cwd === cwd)
  return list.filter(p => p.kind === f)
}

function describe(p: PinboardPin): string {
  return `${GLYPH[p.kind]} ${p.title}`
}

/** Writes the list to session state (redraws the pane) and to the store (survives the session). */
async function persist($: Dollar, list: PinboardPin[]): Promise<void> {
  await update($, pins, () => list)
  await $.store.set(STORE_PINS, list)
}

/** Adds the items not already pinned (same body, whitespace aside), newest first; returns what was added. */
async function addPins($: Dollar, items: PinInput[]): Promise<PinboardPin[]> {
  const [now, sessionId, cwd, current] = await Promise.all([
    $.clock.now(),
    $.session.id(),
    $.session.cwd(),
    read($, pins),
  ])
  const known = new Set(current.map(p => bodyKey(p.body)))
  const added: PinboardPin[] = []
  for (const it of items) {
    const body = it.body.length > MAX_BODY ? `${it.body.slice(0, MAX_BODY)}\n\n…(잘림)` : it.body
    const key = bodyKey(body)
    if (!key || known.has(key)) continue
    known.add(key)
    const pin: PinboardPin = {
      id: newId(now + added.length),
      createdAt: now,
      sessionId,
      cwd,
      kind: it.kind,
      title: it.title || firstLineTitle(body),
      body,
    }
    if (it.sourceUuid) pin.sourceUuid = it.sourceUuid
    added.push(pin)
  }
  if (added.length === 0) return []
  await persist($, [...added, ...current].slice(0, MAX_PINS))
  await update($, selectedId, () => added[0]?.id ?? null)
  await update($, confirmDeleteId, () => null)
  await update($, candidates, list => list.filter(c => !known.has(bodyKey(c.body))))
  return added
}

/** Removes one pin and keeps it as `lastRemoved` for undo. */
async function removePin($: Dollar, id: string): Promise<PinboardPin | undefined> {
  const current = await read($, pins)
  const target = current.find(p => p.id === id)
  if (!target) return undefined
  await persist(
    $,
    current.filter(p => p.id !== id),
  )
  await update($, lastRemoved, () => target)
  await update($, confirmDeleteId, () => null)
  await update($, selectedId, cur => (cur === id ? null : cur))
  return target
}

/** Restores the last removed pin, or the backup `/pin clear` left. */
async function undo($: Dollar): Promise<string> {
  const removed = await read($, lastRemoved)
  if (removed) {
    const current = await read($, pins)
    if (!current.some(p => p.id === removed.id)) await persist($, [removed, ...current].slice(0, MAX_PINS))
    await update($, lastRemoved, () => null)
    await update($, selectedId, () => removed.id)
    return `↩ 되돌림: ${describe(removed)}`
  }
  const backup = await $.store.get(STORE_BACKUP)
  if (Array.isArray(backup) && backup.length > 0) {
    const current = await read($, pins)
    const ids = new Set(current.map(p => p.id))
    const restored = (backup as PinboardPin[]).filter(p => !ids.has(p.id))
    const merged = [...current, ...restored].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PINS)
    await persist($, merged)
    await $.store.delete(STORE_BACKUP)
    return `↩ 되돌림: 핀 ${restored.length}개 복구`
  }
  return '되돌릴 핀이 없습니다.'
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

/**
 * Opens the pane. `asked` means the person did something (a command, a press): it seats at any width and
 * lifts the suppression their close set. Unasked opens respect `/pin auto off` and a close this session.
 */
async function openPane($: Dollar, options: { asked: boolean; focus?: boolean }): Promise<boolean> {
  if (options.asked) {
    await update($, autoOpenSuppressed, () => false)
  } else {
    const auto = (await $.store.get(STORE_AUTO_OPEN)) !== false
    if (!auto || (await read($, autoOpenSuppressed))) return false
  }
  const opened = await $.ui.open(
    options.focus ? { id: PANE, title: PANE_TITLE, focus: true } : { id: PANE, title: PANE_TITLE },
  )
  return opened.isPlaced
}

/** A pin by its number in the pane (filtered, newest first), `last`, its id, or a title substring. */
async function resolvePin($: Dollar, token: string): Promise<PinboardPin | undefined> {
  const list = await read($, pins)
  const t = token.trim()
  if (!t || t === 'last') return list[0]
  const n = Number(t)
  if (Number.isInteger(n) && n >= 1) {
    const shown = visible(list, await read($, filter), await $.session.cwd())
    if (n <= shown.length) return shown[n - 1]
  }
  const lower = t.toLowerCase()
  return list.find(p => p.id === t) ?? list.find(p => p.title.toLowerCase().includes(lower))
}

/** The newest assistant message with text, or undefined before the first reply. */
async function lastAnswer($: Dollar): Promise<string | undefined> {
  const messages = await $.session.messages()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && m.text.trim()) return m.text
  }
  return undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Slash commands: /pin, /unpin, /pins
// ────────────────────────────────────────────────────────────────────────────

const HELP = [
  '/pin                마우스 선택이 있으면 그것을, 없으면 마지막 답변의 표·아티팩트 링크를 저장 (없으면 답변 전체)',
  '/pin [제목]         위와 같되 제목을 지정',
  '/pin all [제목]     마지막 답변 전체 저장',
  '/pin tables|links   마지막 답변의 표만 | 링크만 저장',
  '/pin rm <n|last>    n번(패널 번호) 또는 최근 핀 삭제  (/unpin <n> 도 같음)',
  '/pin undo           마지막 삭제(또는 clear) 되돌리기',
  '/pin show <n>       n번 핀 내용을 대화에 출력 (모델도 읽음)',
  '/pin clear          모두 삭제 (확인 후)',
  '/pin export         ~/.claude/pins/pins-<날짜>.md 로 내보내기',
  '/pin auto on|off    세션 시작·새 후보 감지 시 패널 자동 열기',
  '/pins               패널 열기/닫기',
  '패널 단축키(ctrl+x tab 으로 포커스): 1~9 선택 · a/s/d/g/h 후보 저장 · c 복사 · p 프롬프트에 넣기 · x 삭제 · u 되돌리기 · f 필터',
].join('\n')

function report(added: Awaited<ReturnType<typeof addPins>>): string {
  if (added.length === 0) return '이미 저장된 내용입니다.'
  if (added.length === 1) return `📌 저장: ${describe(added[0]!)}`
  return `📌 ${added.length}개 저장:\n${added.map(p => `  ${describe(p)}`).join('\n')}`
}

async function pinFromAnswer($: Dollar, mode: 'auto' | 'all' | 'links' | 'tables', title: string): Promise<string> {
  const text = await lastAnswer($)
  if (!text) return '저장할 답변이 없습니다.'
  let items: PinInput[]
  if (mode === 'all') items = [{ kind: classify(text), title: title || firstLineTitle(text), body: text.trim() }]
  else if (mode === 'links') items = extractLinks(text, false)
  else if (mode === 'tables') items = extractTables(text)
  else items = extractAll(text)
  if (items.length === 0) {
    if (mode === 'links') return '마지막 답변에 링크가 없습니다.'
    if (mode === 'tables') return '마지막 답변에 표가 없습니다.'
    items = [{ kind: 'text', title: title || firstLineTitle(text), body: text.trim() }]
  } else if (title && mode !== 'all') {
    const n = items.length
    items = items.map((it, i) => ({ ...it, title: n > 1 ? `${title} (${i + 1}/${n})` : title }))
  }
  const added = await addPins($, items)
  await openPane($, { asked: true })
  return report(added)
}

/** `/pin [title]`: the mouse selection when there is one, else the last answer's tables and artifact links. */
async function pinDefault($: Dollar, title: string): Promise<string> {
  let selected: { text: string; requestId?: string } | undefined
  try {
    selected = await $.ui.selection()
  } catch {
    selected = undefined
  }
  const text = selected?.text.trim() ?? ''
  if (text) {
    const item: PinInput = { kind: classify(text), title: title || firstLineTitle(text), body: text }
    if (selected?.requestId) item.sourceUuid = selected.requestId
    const added = await addPins($, [item])
    await openPane($, { asked: true })
    return report(added)
  }
  return pinFromAnswer($, 'auto', title)
}

async function runRemove($: Dollar, token: string): Promise<string> {
  const target = await resolvePin($, token)
  if (!target) return `핀을 찾지 못했습니다: ${token.trim() || '(없음)'}`
  await removePin($, target.id)
  return `🗑 삭제: ${describe(target)}  (/pin undo 로 복구)`
}

async function runShow($: Dollar, token: string): Promise<string> {
  const target = await resolvePin($, token)
  if (!target) return `핀을 찾지 못했습니다: ${token.trim() || '(없음)'}`
  await update($, selectedId, () => target.id)
  await openPane($, { asked: true })
  return `${describe(target)}\n\n${target.body}`
}

async function runClear($: Dollar, rest: string): Promise<string> {
  const list = await read($, pins)
  if (list.length === 0) return '저장된 핀이 없습니다.'
  let ok = rest.trim() === '--yes'
  if (!ok) {
    try {
      ok = (await $.ui.ask(`핀 ${list.length}개를 모두 삭제할까요?`, ['삭제', '취소'])) === '삭제'
    } catch {
      return '취소됨 (대화형이 아니면 /pin clear --yes)'
    }
  }
  if (!ok) return '취소됨'
  await $.store.set(STORE_BACKUP, list)
  await persist($, [])
  await update($, selectedId, () => null)
  await update($, lastRemoved, () => null)
  return `🗑 핀 ${list.length}개 삭제 (/pin undo 로 복구)`
}

async function runExport($: Dollar): Promise<string> {
  const list = await read($, pins)
  if (list.length === 0) return '내보낼 핀이 없습니다.'
  const home = (await $.env.get('HOME')) ?? '.'
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const path = `${home}/.claude/pins/pins-${date}.md`
  const sections = list.map(p => {
    const when = new Date(p.createdAt).toISOString().slice(0, 16).replace('T', ' ')
    return `## ${GLYPH[p.kind]} ${p.title}\n\n_${p.kind} · ${projectName(p.cwd)} · ${when}_\n\n${p.body}\n`
  })
  try {
    await $.fs.write(path, [`# Pins (${list.length}) · ${date}`, '', ...sections].join('\n'))
  } catch (err) {
    return `내보내기 실패: ${String(err)}`
  }
  return `📄 내보냄: ${path}`
}

async function runAuto($: Dollar, rest: string): Promise<string> {
  const v = rest.trim().toLowerCase()
  if (v !== 'on' && v !== 'off') {
    const cur = await $.store.get(STORE_AUTO_OPEN)
    return `자동 열기: ${cur === false ? 'off' : 'on'}  (/pin auto on|off)`
  }
  await $.store.set(STORE_AUTO_OPEN, v === 'on')
  return `자동 열기: ${v}`
}

/** `/pin ...`: the first word picks a subcommand; anything else is a title for the default save. */
async function runPin($: Dollar, rawArgs: string): Promise<string> {
  const args = rawArgs.trim()
  const [head = '', ...tail] = args.split(/\s+/)
  const rest = tail.join(' ').trim()
  switch (head.toLowerCase()) {
    case 'help':
    case '?':
      return HELP
    case 'rm':
    case 'remove':
    case 'del':
    case 'delete':
      return runRemove($, rest)
    case 'undo':
      return undo($)
    case 'show':
    case 'cat':
      return runShow($, rest)
    case 'clear':
      return runClear($, rest)
    case 'export':
      return runExport($)
    case 'auto':
      return runAuto($, rest)
    case 'all':
      return pinFromAnswer($, 'all', rest)
    case 'links':
    case 'link':
      return pinFromAnswer($, 'links', rest)
    case 'tables':
    case 'table':
      return pinFromAnswer($, 'tables', rest)
    default:
      return pinDefault($, args)
  }
}

/** `/pins`: closes the pane when open, else opens it with the keyboard. */
async function togglePane($: Dollar): Promise<string> {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return 'Pins 패널 닫음'
  }
  const placed = await openPane($, { asked: true, focus: true })
  return placed
    ? 'Pins 패널 열림 (ctrl+x tab: 패널 포커스 · Esc: 프롬프트로 · /pin help: 도움말)'
    : 'Pins 패널은 열렸지만 아직 표시되지 않음 (터미널을 넓히면 보입니다)'
}

// ────────────────────────────────────────────────────────────────────────────
// The Pins pane
// ────────────────────────────────────────────────────────────────────────────

const MAX_ROWS = 30
const CANDIDATE_HOTKEYS = ['a', 's', 'd', 'g', 'h']
// Theme keys, so the colors follow the person's light or dark theme.
const ACCENT = 'claude'
const KIND_COLOR: Record<PinboardKind, string> = {
  table: 'suggestion',
  artifact: 'merged',
  link: 'ide',
  text: 'subtle',
}

async function renderPane($: Dollar, e: RenderInputOf<'Pane', RenderSurface>) {
  const { Box, Text, Button, Markdown, Link } = $.ui.resolve(e)
  const [list, f, sel, cands, removed, confirm, now, cwd] = await Promise.all([
    read($, pins),
    read($, filter),
    read($, selectedId),
    read($, candidates),
    read($, lastRemoved),
    read($, confirmDeleteId),
    $.clock.now(),
    $.session.cwd(),
  ])
  const shown = visible(list, f, cwd)
  const selected = shown.find(p => p.id === sel) ?? null
  const width = Math.max(20, e.props.bodyColumns)
  const labelWidth = Math.max(10, width - 12)

  const select = (id: string) => {
    void update($, confirmDeleteId, () => null)
    void update($, selectedId, cur => (cur === id ? null : id))
  }
  const setFilter = (next: PinboardFilter) => {
    void update($, selectedId, () => null)
    void update($, filter, () => next)
  }
  const cycleFilter = () => setFilter(FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length] ?? 'all')
  const counts: Record<PinboardFilter, number> = {
    all: list.length,
    table: list.filter(p => p.kind === 'table').length,
    artifact: list.filter(p => p.kind === 'artifact').length,
    link: list.filter(p => p.kind === 'link').length,
    project: list.filter(p => p.cwd === cwd).length,
  }
  const rule = '─'.repeat(width)

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>
          Pins <Text dimColor>{list.length}</Text>
        </Text>
        <Button key="filter" hotkey="f" plain dimColor label="다음 필터" onPress={cycleFilter} />
      </Box>
      <Box flexWrap="wrap" columnGap={2}>
        {FILTERS.map(name =>
          name === f ? (
            <Text color="claude" bold underline>
              {FILTER_LABEL[name]} {counts[name]}
            </Text>
          ) : (
            <Button
              key={`tab:${name}`}
              plain
              dimColor
              label={`${FILTER_LABEL[name]} ${counts[name]}`}
              onPress={() => setFilter(name)}
            />
          ),
        )}
      </Box>
      <Text dimColor>{rule}</Text>

      {shown.length === 0 && (
        <Text dimColor wrap="wrap">
          {list.length === 0
            ? '저장된 핀이 없습니다. /pin 으로 마지막 답변의 표·링크를 저장하거나, 아래 후보에서 고르세요.'
            : '이 필터에 맞는 핀이 없습니다. f 로 필터를 바꾸세요.'}
        </Text>
      )}

      {shown.slice(0, MAX_ROWS).map((p, i) => {
        const isSelected = p.id === sel
        const hotkey = i < 9 ? String(i + 1) : undefined
        const age = shortAge(now, p.createdAt)
        // marker 2 + "1: " 3 + gap 2 + glyph and age on the right
        const room = width - 2 - 3 - 2 - (2 + textWidth(age))
        const title = fitWidth(hotkey ? p.title : `${i + 1}. ${p.title}`, room)
        return (
          <Box key={`row:${p.id}`} justifyContent="space-between">
            <Box>
              <Text color={ACCENT}>{isSelected ? '▍ ' : '  '}</Text>
              <Button
                key={`sel:${p.id}`}
                {...(hotkey ? { hotkey } : {})}
                plain
                dimColor={!isSelected}
                hover={{ dimColor: false }}
                label={title}
                onPress={() => select(p.id)}
              />
            </Box>
            <Text>
              <Text color={KIND_COLOR[p.kind]}>{GLYPH[p.kind]}</Text> <Text dimColor>{age}</Text>
            </Text>
          </Box>
        )
      })}
      {shown.length > MAX_ROWS && (
        <Text dimColor>
          {'  '}… {shown.length - MAX_ROWS}개 더 · f 로 필터
        </Text>
      )}

      {selected && (
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderDimColor>
          <Text bold wrap="truncate-end">
            {GLYPH[selected.kind]} {selected.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            {selected.kind} · {projectName(selected.cwd)} ·{' '}
            {new Date(selected.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
          </Text>
          {selected.kind === 'link' || selected.kind === 'artifact' ? (
            <Link href={selected.body} />
          ) : (
            <Markdown text={selected.body} />
          )}
          <Box gap={1} marginTop={1} flexWrap="wrap">
            <Button
              key="copy"
              hotkey="c"
              label="복사"
              onPress={press => {
                void $.ui
                  .copy({ text: selected.body, surface: press.surface })
                  .then(r => $.ui.toast(r.isCopied ? '복사됨' : `복사 실패: ${r.reason}`))
              }}
            />
            <Button
              key="prompt"
              hotkey="p"
              label="프롬프트에 넣기"
              onPress={() => {
                void $.prompt.fill({ text: `${selected.body}\n`, mode: 'insert' })
              }}
            />
            {confirm === selected.id ? (
              <Box gap={1}>
                <Button
                  key="delete-yes"
                  hotkey="x"
                  variant="primary"
                  label="정말 삭제"
                  onPress={() => {
                    void removePin($, selected.id)
                  }}
                />
                <Button
                  key="delete-no"
                  hotkey="o"
                  label="취소"
                  onPress={() => void update($, confirmDeleteId, () => null)}
                />
              </Box>
            ) : (
              <Button
                key="delete"
                hotkey="x"
                label="삭제"
                onPress={() => void update($, confirmDeleteId, () => selected.id)}
              />
            )}
          </Box>
        </Box>
      )}

      {removed && (
        <Box marginTop={1}>
          <Button
            key="undo"
            hotkey="u"
            plain
            dimColor
            label={`되돌리기: ${describe(removed)}`.slice(0, labelWidth)}
            onPress={() => {
              void undo($)
            }}
          />
        </Box>
      )}

      {cands.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            최근 후보 (이번 세션, 누르면 저장)
          </Text>
          {cands.map((c, i) => {
            const hotkey = CANDIDATE_HOTKEYS[i]
            return (
              <Box key={`cand:${c.id}`} gap={1}>
                <Button
                  key={`save:${c.id}`}
                  {...(hotkey ? { hotkey } : {})}
                  plain
                  label={`+ ${GLYPH[c.kind]} ${c.title}`.slice(0, labelWidth)}
                  onPress={() => {
                    void addPins($, [{ kind: c.kind, title: c.title, body: c.body, sourceUuid: c.sourceUuid }])
                  }}
                />
                <Text dimColor>{relativeTime(now, c.seenAt)}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {e.props.isFocused
            ? '1-9 선택 · a/s/d/g/h 후보 저장 · c 복사 · p 프롬프트 · x 삭제 · u 되돌리기 · f 필터 · Esc 프롬프트로'
            : 'ctrl+x tab: 패널 포커스 · /pin help: 도움말'}
        </Text>
      </Box>
    </Box>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

/** A plugin tool answers with a string (or an array of content blocks); an object is refused. */
function toolText(text: string) {
  return { result: text }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await Promise.all([
        $.command.register({
          name: 'pin',
          description: '마지막 답변의 표·아티팩트 링크(또는 마우스 선택)를 Pins 패널에 저장',
          argumentHint:
            '[제목] | all | tables | links | rm <n> | undo | show <n> | clear | export | auto on|off | help',
        }),
        $.command.register({ name: 'pins', description: 'Pins 패널 열기/닫기' }),
        $.command.register({ name: 'unpin', description: '핀 삭제 (/pin rm 과 같음)', argumentHint: '<n|last|제목>' }),
        $.tool.register({
          name: 'pin',
          description:
            "Save an item from this conversation into the user's Pins side pane so they can reopen it any time. " +
            "Use when the user asks to pin, save, keep or bookmark a table, link, artifact or answer (e.g. '이 표 저장해줘', '핀해줘'). " +
            'Pass the exact markdown of the item: a whole markdown table, a URL, or the text itself.',
          inputSchema: {
            type: 'object',
            properties: {
              markdown: {
                type: 'string',
                description: 'The item to save, verbatim markdown (a full table, a URL, or text).',
              },
              title: {
                type: 'string',
                description: 'Short title (<= 60 chars). Derived from the content when omitted.',
              },
              kind: {
                type: 'string',
                enum: ['table', 'artifact', 'link', 'text'],
                description: 'Derived from the content when omitted.',
              },
            },
            required: ['markdown'],
          },
        }),
        $.tool.register({
          name: 'unpin',
          description:
            "Remove a pin from the user's Pins pane. Identify it by id, by its 1-based index as `list` shows, or by a title substring. Call `list` first when unsure.",
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              index: { type: 'integer', minimum: 1 },
              title: { type: 'string', description: 'A substring of the pin title.' },
            },
          },
        }),
        $.tool.register({
          name: 'list',
          description: "List the user's saved pins: index, kind, title, project and id.",
        }),
      ])
    } catch (err) {
      $.ui.log(`pinboard: registration failed: ${String(err)}`, { to: 'debug' })
    }

    // The store is the truth; session state mirrors it so the pane redraws on every change.
    const stored = await $.store.get(STORE_PINS)
    const list = Array.isArray(stored) ? (stored as PinboardPin[]) : []
    await update($, pins, () => list)
    if (e.isInteractive && list.length > 0) await openPane($, { asked: false })

    return next(e)
  })

  on('command.run', { command: 'pin' }, async ($, e) => ({ text: await runPin($, e.args) }))
  on('command.run', { command: 'unpin' }, async ($, e) => ({ text: await runRemove($, e.args) }))
  on('command.run', { command: 'pins' }, async $ => ({ text: await togglePane($) }))

  on('tool.call', { tool: 'mcp__pinboard__pin' }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const markdown = typeof input.markdown === 'string' ? input.markdown.trim() : ''
    if (!markdown) return toolText('error: markdown is empty')
    const title = typeof input.title === 'string' ? cleanTitle(input.title) : ''
    const kind = isKind(input.kind) ? input.kind : classify(markdown)
    const added = await addPins($, [{ kind, title, body: markdown }])
    await openPane($, { asked: true })
    const first = added[0]
    return toolText(first ? `pinned: ${describe(first)} (id ${first.id})` : 'already pinned (identical content exists)')
  }).catch(() => ({ deny: 'pinboard: pin failed' }))

  on('tool.call', { tool: 'mcp__pinboard__unpin' }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const token =
      typeof input.id === 'string'
        ? input.id
        : typeof input.index === 'number'
          ? String(input.index)
          : typeof input.title === 'string'
            ? input.title
            : ''
    if (!token) return toolText('error: give id, index or title')
    const target = await resolvePin($, token)
    if (!target) return toolText(`error: no pin matches "${token}"`)
    await removePin($, target.id)
    return toolText(`unpinned: ${describe(target)} (the user can restore it with /pin undo)`)
  }).catch(() => ({ deny: 'pinboard: unpin failed' }))

  on('tool.call', { tool: 'mcp__pinboard__list' }, async $ => {
    const list = await read($, pins)
    if (list.length === 0) return toolText('no pins')
    return toolText(
      list.map((p, i) => `${i + 1}. [${p.kind}] ${p.title} · ${projectName(p.cwd)} · id ${p.id}`).join('\n'),
    )
  }).catch(() => ({ deny: 'pinboard: list failed' }))

  // Every block of a reply on the main loop: its tables and artifact links become one-press candidates.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    try {
      if (e.agentId === undefined && e.message.role === 'assistant') {
        const texts: string[] = []
        for (const block of e.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        }
        const found = texts.flatMap(t => extractAll(t))
        if (found.length > 0) {
          const now = await $.clock.now()
          const pinned = new Set((await read($, pins)).map(p => bodyKey(p.body)))
          const fresh = found.filter(f => !pinned.has(bodyKey(f.body)))
          if (fresh.length > 0) {
            await update($, candidates, list => {
              const have = new Set(list.map(c => bodyKey(c.body)))
              const incoming: PinboardCandidate[] = fresh
                .filter(f => !have.has(bodyKey(f.body)))
                .map((f, i) => ({
                  id: newId(now + i),
                  kind: f.kind,
                  title: f.title,
                  body: f.body,
                  sourceUuid: e.uuid,
                  seenAt: now,
                }))
              return [...incoming, ...list].slice(0, MAX_CANDIDATES)
            })
            // Awaited: work a hook leaves running is dropped when its dispatch ends.
            if (!(await isPaneOpen($))) await openPane($, { asked: false })
          }
        }
      }
    } catch {
      // candidates are best effort; the row is already stored
    }
    return stored
  })

  // The person closed the pane: no unasked reopen until they ask for it again.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, autoOpenSuppressed, () => true)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
