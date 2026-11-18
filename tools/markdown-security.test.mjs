import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeGeneratedMarkup } from './markdown-security.mjs'

test('localized original links and tags remain allowed in every locale', async () => {
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(
    '# 标题\n\n[链接](/zh-cn/A) <a href="/zh-cn/A">A</a>',
    '# Title\n\n[Link](/en/A) <a href="/en/A">A</a>',
    'page'
  ))
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(
    '# 标题\n\n[链接](/zh-cn/A) <a href="/zh-cn/A">A</a>',
    '# 標題\n\n[連結](/zh-tw/A) <a href="/zh-tw/A">A</a>',
    'page'
  ))
  await assert.doesNotReject(() =>
    assertSafeGeneratedMarkup('Text <br/> end.', 'Text <br/> end.', 'page')
  )
})

test('new links, bare URLs, and rewritten targets are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('[a](/A)', '[a](/A) [new](https://evil.example)', 'page'),
    /新增或改写的链接目标/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Added https://evil.example', 'page'),
    /新增或改写的链接目标/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('[a](/A)', '[a](/B)', 'page'),
    /新增或改写的链接目标/
  )
})

test('unsafe URL protocols are rejected even when entity-encoded', async () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java&#115;cript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd'
  ]) {
    await assert.rejects(
      () => assertSafeGeneratedMarkup('Plain.', `[x](${url})`, 'page'),
      /不安全的 URL 协议/
    )
  }
})

test('new HTML tags, event attributes, and dangerous tags are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <span>new</span>', 'page'),
    /新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <img src="/A" onerror="alert(1)">', 'page'),
    /事件属性|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <script>alert(1)</script>', 'page'),
    /不安全的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <a href="javascript:alert(1)">x</a>', 'page'),
    /不安全的 URL 协议|新增的 HTML 标签/
  )
})

test('code fences and inline code are not mistaken for active markup', async () => {
  const source = 'Before.\n\n```html\n<script>alert(1)</script>\n```\n\nUse `<img onerror=x>`.'
  const generated = 'Before.\n\n```html\n<script>alert(1)</script>\n```\n\nUse `<img onerror=x>`.'
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(source, generated, 'page'))
})

test('new Vue interpolation and template directives are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain {{ constructor.constructor("alert(1)")() }}', 'page'),
    /Vue 插值/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <div v-html="payload">x</div>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <a :href="payload">x</a>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <button @click="payload">x</button>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
})

test('a pseudo fence in a real paragraph cannot hide following active HTML', async () => {
  const source = [
    'Paragraph text.',
    '',
    '    ```',
    '    this is indented code, not a fence',
    '',
    'Safe visible text.',
    ''
  ].join('\n')
  const generated = `${source}<img src=x onerror=alert(1)>\n`
  await assert.rejects(
    () => assertSafeGeneratedMarkup(source, generated, 'page'),
    /事件属性|新增的 HTML 标签/
  )
})

test('Vue interpolation in frontmatter is also treated as active content', async () => {
  const source = '---\ntitle: Safe\n---\n\nPlain.\n'
  const generated = '---\ntitle: "{{ alert(1) }}"\n---\n\nPlain.\n'
  await assert.rejects(
    () => assertSafeGeneratedMarkup(source, generated, 'page'),
    /Vue 插值/
  )
})

test('original code and formulas may contain HTML/interpolation unchanged', async () => {
  const source = [
    'Before.',
    '',
    '```html',
    '<script>{{ payload }}</script>',
    '```',
    '',
    'Formula $a < b$ and `{{ x }}` stay code.'
  ].join('\n')
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(source, source, 'page'))
})

test('new inline code containing Vue interpolation is rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain `safe`.', 'Plain `{{ alert(1) }}`.', 'page'),
    /代码\/公式 token|代码/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain `{{ alert(1) }}`.', 'page'),
    /代码\/公式 token|代码/
  )
})

test('parser uncertainty fails closed', async () => {
  const md = {
    parse() {
      throw new Error('synthetic parser failure')
    }
  }
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Changed.', 'page', { md }),
    /Markdown 安全解析失败/
  )
})

test('Mermaid label values are checked as active label text', async () => {
  await assert.doesNotReject(() =>
    assertSafeGeneratedMarkup('小角度', 'Small angle', 'Mermaid 标签')
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('小角度', '<img onerror=x>', 'Mermaid 标签'),
    /事件属性|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('小角度', '[x](javascript:alert(1))', 'Mermaid 标签'),
    /不安全的 URL 协议/
  )
})
