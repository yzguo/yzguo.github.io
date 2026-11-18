import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getMarkdownParser } from './check-bilingual.mjs'
import { convertFrontmatter } from './frontmatter-translate.mjs'
import { convertMermaidSource } from './mermaid-translate.mjs'
import {
  assertTraditionalText,
  convertBodyToTraditional,
  convertMarkdownToTraditional,
  convertTextToTraditional,
  findSimplifiedText,
  traditionalTextIssues
} from './traditional-chinese.mjs'

async function makeParser(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'traditional-test-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  await mkdir(path.join(rootDir, 'docs'), { recursive: true })
  return getMarkdownParser(path.join(rootDir, 'docs'))
}

test('OpenCC produces real Traditional script and vocabulary locally', () => {
  const converted = convertTextToTraditional('软件、网络、后台数据库里的头发。')
  assert.equal(converted, '軟體、網路、後臺資料庫裡的頭髮。')
  assert.notEqual(converted, '软件、网络、后台数据库里的头发。')
  assert.equal(convertTextToTraditional(''), '')

  assert.equal(findSimplifiedText('繁體中文與網路'), null)
  assert.deepEqual(findSimplifiedText('简体中文'), {
    index: 0,
    simplified: '简',
    traditional: '簡'
  })
  assert.doesNotThrow(() => assertTraditionalText('繁體中文'))
  assert.throws(() => assertTraditionalText('简体中文'), /未转换的简体内容/)
})

test('regional Traditional wording is not rejected as a Simplified copy', () => {
  assert.equal(findSimplifiedText('查看專案與課程紀錄'), null)
  assert.throws(
    () => assertTraditionalText('简体页面直接复制'),
    /「简」.*「簡」/
  )
})

test('frontmatter values convert while keys, URLs, and paths stay exact', () => {
  const source = [
    'layout: home',
    'hero:',
    '  name: "郭彦禛"',
    '  image:',
    '    src: /images/中文图片.png',
    '  actions:',
    '    - text: 笔记',
    '      link: /zh-cn/Notes/',
    '  url: https://example.com/中文',
    ''
  ].join('\n')

  const converted = convertFrontmatter(source, { convertText: convertTextToTraditional })
  assert.match(converted, /name: "郭彥禛"/)
  assert.match(converted, /text: 筆記/)
  assert.match(converted, /src: \/images\/中文图片\.png/)
  assert.match(converted, /link: \/zh-tw\/Notes\//)
  assert.match(converted, /url: https:\/\/example\.com\/中文/)
  assert.doesNotMatch(converted, /郭彦禛|笔记/)
})

test('body conversion preserves code, formulas, links, and HTML targets', () => {
  const source = [
    '# 标题',
    '',
    '行内 `代码` 与公式 $E=mc^2$。',
    '',
    '```python',
    '# 中文注释保持不变',
    'print("简体")',
    '```',
    '',
    '链接 [笔记](/zh-cn/Notes/)，图片 ![图](/images/pic.png)，',
    '<a href="/zh-cn/About/">关于</a>。',
    ''
  ].join('\n')

  const converted = convertBodyToTraditional(source)
  assert.match(converted, /# 標題/)
  assert.ok(converted.includes('`代码`'))
  assert.ok(converted.includes('$E=mc^2$'))
  assert.ok(converted.includes('```python\n# 中文注释保持不变\nprint("简体")\n```'))
  assert.ok(converted.includes('[筆記](/zh-tw/Notes/)'))
  assert.ok(converted.includes('![圖](/images/pic.png)'))
  assert.ok(converted.includes('<a href="/zh-tw/About/">關於</a>'))
  assert.doesNotMatch(converted, /不能写出的内容|private:start/)
})

test('a bare URL link label keeps its target during Traditional conversion', () => {
  assert.equal(
    convertBodyToTraditional('[https://example.com/label](/zh-cn/Notes/)'),
    '[https://example.com/label](/zh-tw/Notes/)'
  )
})

test('Mermaid conversion changes visible labels but never syntax or ids', () => {
  const source = [
    'flowchart TD',
    '    A[小角度] --> B[运动方程]',
    '    B -->|推导| C[周期 T]',
    '    %% 中文注释保留',
    '    classDef note fill:#fff'
  ].join('\n')
  const converted = convertMermaidSource(source, convertTextToTraditional)
  assert.match(converted, /A\[小角度\] --> B\[運動方程\]/)
  assert.match(converted, /B -->\|推導\| C\[週期 T\]/)
  assert.match(converted, /%% 中文注释保留/)
  assert.match(converted, /classDef note fill:#fff/)
  assert.match(converted, /flowchart TD/)
})

test('whole-page conversion validates structure, privacy, safety, and script', async (t) => {
  const md = await makeParser(t)
  const source = [
    '---',
    'title: 标题',
    'link: /zh-cn/Notes/',
    '---',
    '',
    '# 标题',
    '',
    '欢迎。第一段。<!-- 私密注记 -->',
    '',
    '![图片](/zh-cn/images/pic.png)',
    '',
    '\\[',
    'E=mc^2',
    '\\]',
    '',
    '```mermaid',
    'flowchart TD',
    '    A[小角度] --> B[运动方程]',
    '```',
    '',
    '[笔记](/zh-cn/Notes/)',
    '',
    '<!-- private:start -->',
    '不能发送或写入。',
    '<!-- private:end -->',
    ''
  ].join('\n')

  const converted = await convertMarkdownToTraditional(source, { md })
  assert.match(converted, /title: 標題/)
  assert.match(converted, /link: \/zh-tw\/Notes\//)
  assert.match(converted, /# 標題/)
  assert.match(converted, /歡迎。第一段。/)
  assert.ok(converted.includes('![圖片](/images/pic.png)'))
  assert.ok(converted.includes('\\[\nE=mc^2\n\\]'))
  assert.ok(converted.includes('A[小角度] --> B[運動方程]'))
  assert.ok(converted.includes('[筆記](/zh-tw/Notes/)'))
  assert.doesNotMatch(converted, /私密注记|不能发送或写入|private:start/)

  assert.deepEqual(
    await traditionalTextIssues(converted, { md, file: 'docs/zh-tw/index.md' }),
    []
  )
  const copied = await traditionalTextIssues(source, { md, file: 'copy' })
  assert.equal(copied.length, 1)
  assert.match(copied[0], /未转换的简体内容/)
})

test('conversion refuses malformed input instead of emitting partial output', async (t) => {
  const md = await makeParser(t)
  await assert.rejects(
    convertMarkdownToTraditional('---\ntitle: 标题\n', { md }),
    /Unclosed frontmatter/
  )
  await assert.rejects(
    convertMarkdownToTraditional('# 标题\n<!-- private:start -->\n秘密\n', { md }),
    /Unclosed private block/
  )
  await assert.rejects(
    convertMarkdownToTraditional('# 标题\n', {}),
    /Markdown 解析器/
  )
  assert.throws(() => convertTextToTraditional(null), /字符串/)
})
