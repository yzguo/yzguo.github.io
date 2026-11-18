import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maskMarkdown,
  restoreMaskedMarkdown,
  unwrapMarkdownFence
} from './markdown-protect.mjs'

const prefix = 'TESTTOKEN'

test('masking preserves syntax while leaving visible prose translatable', () => {
  const body = [
    '# 标题',
    '',
    '文字 `行内代码` 和公式 $a+b$ 以及 ![图片](/zh-cn/images/pic.png)。',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[中文] --> B[结束]',
    '```',
    '',
    '链接 [博客](/zh-cn/Notes/) 与 <a href="/zh-cn/About/">关于</a>。',
    '',
    '[ref]: /zh-cn/Projects/ "项目"'
  ].join('\n')

  const masked = maskMarkdown(body, { tokenPrefix: prefix })
  assert.match(masked.text, /# 标题/)
  assert.match(masked.text, /文字 @@TESTTOKEN_\d+@@ 和公式/)
  assert.doesNotMatch(masked.text, /行内代码|a\+b|中文\]|\/zh-cn|flowchart/)
  assert.equal(masked.tokens.length, 8)
  assert.ok(masked.tokens.every((entry) => entry.token.includes(prefix)))

  const translated = masked.text
    .replace('# 标题', '# Title')
    .replace('文字 ', 'Text ')
    .replace('和公式', 'and formula')
    .replace('链接 ', 'Links ')
    .replace('与 ', 'and ')
    .replace('关于', 'About')
    .replace('。', '.')
  const restored = restoreMaskedMarkdown(translated, masked.tokens)
  assert.match(restored, /`行内代码`/)
  assert.match(restored, /\$a\+b\$/)
  assert.match(restored, /!\[图片\]\(\/images\/pic\.png\)/)
  assert.match(restored, /\[博客\]\(\/en\/Notes\/\)/)
  assert.match(restored, /<a href="\/en\/About\/">About<\/a>/)
  assert.match(restored, /```mermaid\nflowchart TD\n  A\[中文\] --> B\[结束\]\n```/)
  assert.match(restored, /\[ref\]: \/en\/Projects\/ "项目"/)
})

test('masking can target Traditional, canonical, or raw destinations', () => {
  const source = '[博客](/zh-cn/Notes/) 与 <a href="/zh-cn/About/">关于</a>'

  const traditional = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: 'zh-tw' })
  assert.ok(traditional.tokens.some((entry) => entry.value === '(/zh-tw/Notes/)'))
  assert.ok(traditional.tokens.some((entry) => entry.value === '<a href="/zh-tw/About/">'))

  const canonical = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: 'canonical' })
  assert.ok(canonical.tokens.some((entry) => entry.value === '(/Notes/)'))
  assert.ok(canonical.tokens.some((entry) => entry.value === '<a href="/About/">'))

  const preserved = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: null })
  assert.ok(preserved.tokens.some((entry) => entry.value === '(/zh-cn/Notes/)'))
  assert.ok(preserved.tokens.some((entry) => entry.value === '<a href="/zh-cn/About/">'))
})

test('whole-link targets are localized without rewriting labels', () => {
  const masked = maskMarkdown('[`代码`](/zh-cn/Notes/)', {
    tokenPrefix: prefix,
    targetLocale: 'zh-tw'
  })
  assert.equal(masked.tokens[0].kind, 'link-whole')
  assert.match(masked.tokens[0].value, /\]\(\/zh-tw\/Notes\/\)$/)
  assert.doesNotMatch(masked.tokens[0].value, /\/zh-cn\//)
})

test('placeholders must appear exactly once and in order', () => {
  const masked = maskMarkdown('A `one` B `two`', { tokenPrefix: prefix })
  const [first, second] = masked.tokens
  assert.throws(
    () => restoreMaskedMarkdown(`A ${first.token} B`, masked.tokens),
    /dropped/
  )
  assert.throws(
    () => restoreMaskedMarkdown(`A ${first.token} ${first.token} B ${second.token}`, masked.tokens),
    /duplicated/
  )
  assert.throws(
    () => restoreMaskedMarkdown(`B ${second.token} A ${first.token}`, masked.tokens),
    /reordered/
  )
})

test('a bare URL as a link label keeps its closing bracket', () => {
  const body = '[https://example.com/label](https://example.com/target)'
  const masked = maskMarkdown(body, {
    tokenPrefix: prefix,
    protectBareUrls: true,
    targetLocale: 'zh-tw'
  })
  assert.match(masked.text, /^\[@@[A-Za-z0-9_]+@@\]@@TESTTOKEN_\d+@@$/)
  assert.equal(restoreMaskedMarkdown(masked.text, masked.tokens), body)
  assert.throws(
    () => restoreMaskedMarkdown(masked.text.replace(']@@', '@@'), masked.tokens),
    /broke the Markdown link syntax/
  )
})

test('a model that separates a link target from its label fails', () => {
  const masked = maskMarkdown('[链接](/zh-cn/x)', { tokenPrefix: prefix })
  const broken = masked.text.replace(']', '] ')
  assert.throws(
    () => restoreMaskedMarkdown(broken, masked.tokens),
    /broke the Markdown link syntax/
  )
})

test('unbalanced or unsupported constructs fail rather than leaking markup', () => {
  const masked = maskMarkdown('Text [link](/zh-cn/x) and `code', { tokenPrefix: prefix })
  assert.equal(masked.tokens.length, 1)
  assert.match(masked.text, /`code/)
})

test('a wrapping Markdown fence is removed once', () => {
  assert.equal(unwrapMarkdownFence('```markdown\n# Title\n```'), '# Title')
  assert.equal(unwrapMarkdownFence('~~~\n# Title\n~~~'), '# Title')
  assert.equal(unwrapMarkdownFence('# Title'), '# Title')
  assert.equal(unwrapMarkdownFence('```\n# Title\n```\ntrailing'), '```\n# Title\n```\ntrailing')
})
