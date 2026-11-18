import assert from 'node:assert/strict'
import test from 'node:test'
import { maskMarkdown } from './markdown-protect.mjs'
import { segmentMarkdown } from './markdown-segment.mjs'

function complexBody() {
  const rows = []
  for (let index = 0; index < 18; index += 1) {
    rows.push(`| [链接${index}](/zh-cn/A/${index}) | \`代码${index}\` | 中文说明 ${index} |`)
  }
  return [
    '# 标题',
    '',
    '第一段包含 [链接](/zh-cn/Notes/) 和 `行内代码`，另有 $x+y$。',
    '',
    '| 名称 | 代码 | 说明 |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '```python',
    '# 代码中的中文不受影响',
    'print("保留")',
    '```',
    '',
    '结尾段落。',
    ''
  ].join('\n')
}

test('segmentation preserves the source exactly', () => {
  const body = complexBody()
  const parts = segmentMarkdown(body, { maxChars: 800, maxTokens: 12 })
  assert.equal(parts.map((part) => part.text).join(''), body)
  assert.ok(parts.some((part) => part.kind === 'fence' && !part.translatable))
  assert.ok(parts.some((part) => part.kind === 'blank' && !part.translatable))
  assert.ok(parts.filter((part) => part.translatable).length > 1)
})

test('no translatable segment exceeds configured token or character budgets', () => {
  const body = complexBody()
  const parts = segmentMarkdown(body, { maxChars: 800, maxTokens: 12 })
  for (const part of parts.filter((entry) => entry.translatable)) {
    const tokens = maskMarkdown(part.text, { protectPipes: true }).tokens.length
    assert.ok(tokens <= 12, `segment has ${tokens} protected tokens`)
    assert.ok(part.text.length <= 800, `segment has ${part.text.length} characters`)
  }
})

test('a long table is split without changing table syntax', () => {
  const body = complexBody()
  const parts = segmentMarkdown(body, { maxChars: 600, maxTokens: 10 })
  const translatable = parts.filter((part) => part.translatable).map((part) => part.text).join('')
  assert.match(translatable, /\| 名称 \| 代码 \| 说明 \|/)
  assert.match(translatable, /\| \[链接17\]\(\/zh-cn\/A\/17\) \| `代码17` \| 中文说明 17 \|/)
})

test('fenced code is never made translatable even when it contains blank lines', () => {
  const body = [
    '前文。',
    '',
    '```mermaid',
    'flowchart TD',
    '',
    '  A[中文] --> B[结束]',
    '```',
    '',
    '后文。'
  ].join('\n')
  const parts = segmentMarkdown(body)
  const fence = parts.find((part) => part.kind === 'fence')
  assert.ok(fence)
  assert.equal(fence.translatable, false)
  assert.match(fence.text, /A\[中文\] --> B\[结束\]/)
})
