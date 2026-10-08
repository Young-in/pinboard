import { expect, test } from 'claude-code/testing'

import { classify, extractAll, extractLinks, extractTables, firstLineTitle } from './extract'

const REPLY = [
  '## 결과',
  '',
  '모델별 점수 비교:',
  '',
  '| 모델 | 점수 |',
  '|---|---|',
  '| A | 1 |',
  '| B | 2 |',
  '',
  '리포트는 [대시보드](https://claude.ai/artifact/abc123) 에 있고, 참고 문서는 https://example.com/docs 입니다.',
  '',
  '| x |',
  '| :-- |',
  '| y |',
].join('\n')

test('extractTables finds every table and titles it from the line above', async () => {
  const found = extractTables(REPLY)
  expect(found).toHaveLength(2)
  expect(found[0]?.title).toBe('모델별 점수 비교')
  expect(found[0]?.body.split('\n')).toHaveLength(4)
  expect(found[1]?.title).toBe('x')
})

test('extractLinks classifies artifact links and keeps markdown labels', async () => {
  const all = extractLinks(REPLY, false)
  expect(all).toHaveLength(2)
  expect(all[0]).toMatchObject({ kind: 'artifact', title: '대시보드', body: 'https://claude.ai/artifact/abc123' })
  expect(all[1]).toMatchObject({ kind: 'link', body: 'https://example.com/docs' })
  expect(extractLinks(REPLY, true)).toHaveLength(1)
})

test('extractAll returns tables then artifact links only', async () => {
  const kinds = extractAll(REPLY).map(f => f.kind)
  expect(kinds).toEqual(['table', 'table', 'artifact'])
})

test('classify and firstLineTitle', async () => {
  expect(classify('https://claude.ai/code/artifact/xyz')).toBe('artifact')
  expect(classify('https://example.com')).toBe('link')
  expect(classify('| a |\n|---|\n| 1 |')).toBe('table')
  expect(classify('plain words')).toBe('text')
  expect(firstLineTitle('\n\n# **Heading**: \nbody')).toBe('Heading')
})
