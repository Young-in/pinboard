import { expect, test } from 'claude-code/testing'

import { fitWidth, localStamp, shortAge, textWidth } from './format'

test('textWidth counts Hangul and CJK as two cells', async () => {
  expect(textWidth('abc')).toBe(3)
  expect(textWidth('모델')).toBe(4)
  expect(textWidth('A표1')).toBe(4)
})

test('fitWidth cuts by cells and marks the cut', async () => {
  expect(fitWidth('모델별 벤치마크 점수', 30)).toBe('모델별 벤치마크 점수')
  expect(fitWidth('모델별 벤치마크 점수', 8)).toBe('모델별…')
  expect(textWidth(fitWidth('모델별 벤치마크 점수', 8))).toBeLessThanOrEqual(8)
  expect(fitWidth('abcdef', 4)).toBe('abc…')
  expect(fitWidth('abc', 0)).toBe('')
})

test('shortAge steps from seconds to dates', async () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0)
  expect(shortAge(now, now - 10_000)).toBe('방금')
  expect(shortAge(now, now - 5 * 60_000)).toBe('5분')
  expect(shortAge(now, now - 3 * 3_600_000)).toBe('3시간')
  expect(shortAge(now, now - 2 * 86_400_000)).toBe('2일')
  expect(shortAge(now, now - 30 * 86_400_000)).toMatch(/^\d\d-\d\d$/)
})

test('localStamp has a fixed shape', async () => {
  expect(localStamp(Date.UTC(2026, 9, 8, 12, 0, 0))).toMatch(/^2026-10-0[89] \d\d:\d\d$/)
})
