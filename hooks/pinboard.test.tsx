import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { textWidth } from './format'

const PANE_PROPS = {
  title: 'Pins',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

type StoredPin = { id: string; kind: string; title: string; body: string }

/** The engine beneath the plugin: what a session answers, from memory. */
function engine(on: On) {
  const store = new Map<string, unknown>()
  mock.clock(on)
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/tmp/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pinboard__${e.name}` } }))
  const opens: string[] = []
  on('ui.open', ($, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  return { pins: () => (store.get('pins') as StoredPin[] | undefined) ?? [], opens }
}

test('pin tool stores a pin; the pane lists it, deletes on a second press, and undoes', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })

  await $.tool.call({
    tool: 'mcp__pinboard__pin',
    title: '모델 점수',
    markdown: '| 모델 | 점수 |\n|---|---|\n| A | 1 |',
  })
  expect(world.pins()).toHaveLength(1)
  expect(world.pins()[0]).toMatchObject({ kind: 'table', title: '모델 점수' })
  const id = world.pins()[0]!.id

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pinboard',
      surface,
      component: 'Pane',
      requestId: 'pins',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Button', key: `sel:${id}` })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()

    expect(await ui.find({ type: 'Text', text: /^표 · proj · \d{4}-\d\d-\d\d \d\d:\d\d$/ })).toBeDefined()
    expect(await ui.find({ key: 'copy' })).toBeDefined()

    await ui.press({ key: 'delete' })
    expect(await ui.find({ key: 'delete-yes' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /정말 삭제할까요/ })).toBeDefined()
    expect(await ui.find({ key: 'copy' })).toBeUndefined()
    expect(world.pins()).toHaveLength(1)

    await ui.press({ key: 'delete-yes' })
    expect(world.pins()).toHaveLength(0)
    expect(await ui.find({ key: 'undo' })).toBeDefined()

    await ui.press({ key: 'undo' })
    expect(world.pins()).toHaveLength(1)
    await ui.unmount()
  }
})

test('filter tabs show counts and narrow the list', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'mcp__pinboard__pin', markdown: '| a |\n|---|\n| 1 |', title: '표 하나' })
  await $.tool.call({ tool: 'mcp__pinboard__pin', markdown: 'https://example.com/docs', title: '문서 링크' })
  const [link, table] = world.pins()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pinboard',
      surface,
      component: 'Pane',
      requestId: 'pins',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /전체 2/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'tab:link' }))?.text).toContain('링크 1')

    await ui.press({ key: 'tab:link' })
    expect(await ui.find({ key: `sel:${link!.id}` })).toBeDefined()
    expect(await ui.find({ key: `sel:${table!.id}` })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'tab:all' })).toBeDefined()

    await ui.press({ key: 'tab:all' })
    expect(await ui.find({ key: `sel:${table!.id}` })).toBeDefined()
    await ui.unmount()
  }
})

test('rows fit long titles to the pane width and mark the selected one', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  await $.tool.call({
    tool: 'mcp__pinboard__pin',
    markdown: '| a |\n|---|\n| 1 |',
    title: '아주 긴 제목이 패널 폭을 넘어가는 경우를 확인하기 위한 핀',
  })
  const id = world.pins()[0]!.id
  const ui = await $.ui.mount({
    plugin: 'pinboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pins',
    props: { ...PANE_PROPS, bodyColumns: 30 },
  })
  const row = await ui.find({ key: `sel:${id}` })
  expect(row?.text).toContain('…')
  expect(textWidth(row?.text ?? '')).toBeLessThanOrEqual(30)
  expect(await ui.find({ type: 'Text', text: /▍/ })).toBeDefined()

  await ui.press({ key: `sel:${id}` })
  expect(await ui.find({ type: 'Text', text: /▍/ })).toBeUndefined()
  await ui.unmount()
})

test('unpin and list tools work by title and index', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'mcp__pinboard__pin', markdown: 'https://claude.ai/artifact/one', title: '첫째' })
  await $.tool.call({ tool: 'mcp__pinboard__pin', markdown: 'https://claude.ai/artifact/two', title: '둘째' })
  expect(world.pins().map(p => p.title)).toEqual(['둘째', '첫째'])

  const listed = await $.tool.call({ tool: 'mcp__pinboard__list' })
  expect(JSON.stringify(listed.result)).toContain('[artifact] 둘째')

  await $.tool.call({ tool: 'mcp__pinboard__unpin', title: '첫째' })
  expect(world.pins().map(p => p.title)).toEqual(['둘째'])

  await $.tool.call({ tool: 'mcp__pinboard__unpin', index: 1 })
  expect(world.pins()).toHaveLength(0)
})

test('a reply with a table becomes a candidate the pane saves on one press', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  const reply = '실험 결과:\n\n| run | acc |\n|---|---|\n| 1 | 0.9 |\n\n링크: https://claude.ai/artifact/abc'
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: reply }] },
    door: 'response',
    origin: { kind: 'model', model: 'test-model' },
    uuid: 'row-1',
  })
  expect(world.pins()).toHaveLength(0)

  const ui = await $.ui.mount({
    plugin: 'pinboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pins',
    props: PANE_PROPS,
  })
  const table = await ui.find({ type: 'Button', text: /실험 결과/ })
  expect(table).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /artifact abc/ })).toBeDefined()

  await ui.press({ key: table!.key! })
  expect(world.pins()).toHaveLength(1)
  expect(world.pins()[0]).toMatchObject({ kind: 'table', title: '실험 결과' })
  expect(await ui.find({ key: table!.key! })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /이번 세션의 후보/ })).toBeDefined()
  await ui.unmount()
})

test('an empty board explains how to pin', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pinboard',
      surface,
      component: 'Pane',
      requestId: 'pins',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /아직 핀이 없어요/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\/pin +$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a new candidate opens the pane unasked once; /pins opens it asked', async ($, on) => {
  const world = engine(on)
  await $.session.start({ cwd: '/tmp/proj', surface: 'terminal', isInteractive: false })
  const append = (uuid: string, text: string) =>
    $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
      door: 'response',
      origin: { kind: 'model', model: 'test-model' },
      uuid,
    })
  await append('row-1', '| a | b |\n|---|---|\n| 1 | 2 |')
  expect(world.opens).toEqual(['pins'])

  await append('row-2', 'no table here')
  expect(world.opens).toEqual(['pins'])

  const { text } = await $.command.run({
    command: 'pins',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(text).toContain('열림')
  expect(world.opens).toEqual(['pins', 'pins'])
})
