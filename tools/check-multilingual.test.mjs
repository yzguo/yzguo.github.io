import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  analyzeMarkdown,
  checkMultilingual,
  compareStructures,
  compareUiConfigurations,
  parseBatchVerdicts,
  parseCheckerArgs,
  parseVerdict,
  semanticBatchLimits
} from './check-multilingual.mjs'
import { getMarkdownParser } from './markdown-safety.mjs'
import {
  convertMarkdownToTraditional,
  convertTextToTraditional
} from './traditional-chinese.mjs'

const defaultReadme = {
  'README.md': '# Project\n\nEnglish readme.\n',
  'README.zh-CN.md': '# 项目\n\n中文说明。\n',
  'README.zh-TW.md': convertTextToTraditional('# 项目\n\n中文说明。\n')
}

async function makeProject(t, files = {}, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'trilingual-check-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))

  const allFiles = {
    ...(options.includeReadme === false ? {} : defaultReadme),
    ...files
  }

  for (const [relative, content] of Object.entries(allFiles)) {
    const target = path.join(rootDir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await mkdir(path.join(rootDir, 'docs'), { recursive: true })

  return rootDir
}

async function addPage(rootDir, file, { english, chinese, traditional, md } = {}) {
  await mkdir(path.join(rootDir, 'docs', 'en', path.dirname(file)), { recursive: true })
  await mkdir(path.join(rootDir, 'docs', 'zh-cn', path.dirname(file)), { recursive: true })
  await mkdir(path.join(rootDir, 'docs', 'zh-tw', path.dirname(file)), { recursive: true })
  await writeFile(path.join(rootDir, 'docs', 'en', file), english, 'utf8')
  await writeFile(path.join(rootDir, 'docs', 'zh-cn', file), chinese, 'utf8')
  const converted = traditional ?? (
    md
      ? await convertMarkdownToTraditional(chinese, { md })
      : convertTextToTraditional(chinese).replaceAll('/zh-cn/', '/zh-tw/')
  )
  await writeFile(path.join(rootDir, 'docs', 'zh-tw', file), converted, 'utf8')
}

async function parser(rootDir) {
  return getMarkdownParser(path.join(rootDir, 'docs'))
}

function batchIds(prompt) {
  return [...prompt.matchAll(/ITEM id="([^"]+)"/g)].map((match) => match[1])
}

function batchItemBlock(prompt, id) {
  const marker = `ITEM id="${id}"`
  const start = prompt.indexOf(marker)
  if (start === -1) return ''
  const end = prompt.indexOf('<<<END ITEM', start)
  return prompt.slice(start, end === -1 ? undefined : end)
}

function batchReply(prompt, decide = () => ({ equivalent: true, issues: [] })) {
  const ids = batchIds(prompt)
  assert.ok(ids.length > 0, 'expected a batch prompt with item ids')
  return JSON.stringify({
    results: ids.map((id) => {
      const verdict = decide(id, batchItemBlock(prompt, id)) ?? {
        equivalent: true,
        issues: []
      }
      return { id, equivalent: verdict.equivalent, issues: verdict.issues ?? [] }
    })
  })
}

function successfulRequest(verdict, seen = []) {
  return async ({ prompt }) => {
    seen.push(prompt)
    return batchReply(prompt, () => verdict)
  }
}

function validResult(prompt) {
  return batchReply(prompt)
}

function isEnglishPrompt(prompt, file = 'index.md') {
  return prompt.includes(`Page pair: docs/en/${file} vs docs/zh-cn/${file}`)
}

function isTraditionalPrompt(prompt, file = 'index.md') {
  return prompt.includes(`Page pair: docs/zh-tw/${file} vs docs/zh-cn/${file}`)
}

function matchingSiteConfigs() {
  const englishTheme = {
    nav: [{ text: 'Home', link: '/en/' }],
    sidebar: { '/en/': [{ text: 'Home', link: '/en/' }] },
    editLink: { text: 'Edit this page' },
    docFooter: { prev: 'Previous page', next: 'Next page' },
    outline: { label: 'On this page' },
    lastUpdated: { text: 'Last updated' },
    langMenuLabel: 'Languages',
    returnToTopLabel: 'Return to top',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Appearance',
    lightModeSwitchTitle: 'Switch to light theme',
    darkModeSwitchTitle: 'Switch to dark theme'
  }
  const chineseTheme = {
    nav: [{ text: '首页', link: '/zh-cn/' }],
    sidebar: { '/zh-cn/': [{ text: '首页', link: '/zh-cn/' }] },
    editLink: { text: '编辑此页' },
    docFooter: { prev: '上一页', next: '下一页' },
    outline: { label: '页面目录' },
    lastUpdated: { text: '最后更新于' },
    langMenuLabel: '多语言',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
  const traditionalTheme = {
    nav: [{ text: '首頁', link: '/zh-tw/' }],
    sidebar: { '/zh-tw/': [{ text: '首頁', link: '/zh-tw/' }] },
    editLink: { text: '編輯此頁' },
    docFooter: { prev: '上一頁', next: '下一頁' },
    outline: { label: '頁面目錄' },
    lastUpdated: { text: '最後更新於' },
    langMenuLabel: '多語言',
    returnToTopLabel: '回到頂部',
    sidebarMenuLabel: '選單',
    darkModeSwitchLabel: '主題',
    lightModeSwitchTitle: '切換到淺色模式',
    darkModeSwitchTitle: '切換到深色模式'
  }

  return {
    englishConfig: {
      title: 'Site',
      description: 'English description.',
      themeConfig: englishTheme
    },
    chineseConfig: {
      title: '站点',
      description: '中文描述。',
      themeConfig: chineseTheme
    },
    traditionalConfig: {
      title: '站點',
      description: '繁體中文描述。',
      themeConfig: traditionalTheme
    },
    errors: []
  }
}

function checkWithConfig(options) {
  return checkMultilingual({
    loadSiteConfigs: async () => matchingSiteConfigs(),
    ...options
  })
}

async function basicProject(t, page = {
  english: '# Home\n\nWelcome.\n',
  chinese: '# 首页\n\n欢迎。\n'
}) {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', { ...page, md })
  return rootDir
}

test('Markdown structure ignores headings and comments inside fenced code', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const source = [
    '# Real heading',
    '',
    '```python',
    '# this is a comment, not a heading',
    '## neither is this',
    '```',
    '',
    '```markdown',
    '| fake | table |',
    '| --- | --- |',
    '# fake heading',
    '```',
    '',
    '| Left | Right |',
    '| --- | --- |',
    '| 1 | 2 |',
    ''
  ].join('\n')

  const structure = analyzeMarkdown(source, md)
  assert.deepEqual(structure.headings, [1])
  assert.deepEqual(structure.codeBlocks, ['python', 'markdown'])
  assert.deepEqual(structure.tables, [{ rows: 2, columns: 2 }])
  assert.deepEqual(structure.tableRows, [[2, 2]])
  assert.deepEqual(
    structure.contentStructure.map((node) => node.kind),
    ['heading:1', 'code', 'code', 'table']
  )
  assert.deepEqual(structure.blocks, ['heading:1', 'code', 'code', 'table'])
})

test('translated fenced-code comments do not create structure differences', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const english = analyzeMarkdown('# Example\n\n```python\n# comment\nprint(1)\n```\n', md)
  const chinese = analyzeMarkdown('# 示例\n\n```python\n# 注释\nprint(1)\n```\n', md)

  assert.deepEqual(
    compareStructures('docs/en/demo.md', 'docs/zh-cn/demo.md', english, chinese),
    []
  )
})

test('HTML comments do not affect visible structure', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const english = analyzeMarkdown('# Title\n\n<!-- editorial note -->\n\nA paragraph.\n', md)
  const chinese = analyzeMarkdown('# 标题\n\n一段文字。\n', md)

  assert.deepEqual(
    compareStructures('docs/en/demo.md', 'docs/zh-cn/demo.md', english, chinese),
    []
  )
})

test('real heading, code block, and table differences are reported', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const english = analyzeMarkdown(
    '# Title\n\n## Section\n\n```js\nconst value = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    md
  )
  const chinese = analyzeMarkdown(
    '# 标题\n\n### 部分\n\n```ts\nconst value = 1\n```\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n',
    md
  )

  const errors = compareStructures(
    'docs/en/demo.md',
    'docs/zh-cn/demo.md',
    english,
    chinese
  ).join('\n')
  assert.match(errors, /heading levels differ/)
  assert.match(errors, /code blocks differ/)
  assert.match(errors, /table shapes differ/)
  assert.match(errors, /docs\/en\/demo\.md/)
})

test('block-level content structure differences are reported', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const english = analyzeMarkdown('# Title\n\nA paragraph.\n', md)
  const chinese = analyzeMarkdown('# 标题\n\n> 一段引用。\n', md)

  const errors = compareStructures('docs/en/demo.md', 'docs/zh-cn/demo.md', english, chinese)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /content block structure differ/)
})

test('verdict parsing accepts only a complete structured verdict', () => {
  assert.deepEqual(parseVerdict('{"equivalent":true,"issues":[]}'), {
    equivalent: true,
    issues: []
  })
  assert.deepEqual(parseVerdict('```json\n{"equivalent":true,"issues":[]}\n```'), {
    equivalent: true,
    issues: []
  })

  assert.throws(() => parseVerdict('the pages look fine'), /not valid JSON/)
  assert.throws(() => parseVerdict('{"equivalent":false,"issues":[]}'), /provides no issues/)
  assert.throws(() => parseVerdict('{"equivalent":true,"issues":["minor"]}'), /also reports issues/)
  assert.throws(() => parseVerdict('{"equivalent":"yes","issues":[]}'), /boolean "equivalent"/)
  assert.throws(() => parseVerdict('{"equivalent":true,"issues":[1]}'), /non-empty strings/)
})

test('batch verdict parsing requires exactly one valid result per id', () => {
  const valid = JSON.stringify({
    results: [
      { id: 'a', equivalent: true, issues: [] },
      { id: 'b', equivalent: false, issues: ['missing item'] }
    ]
  })
  const parsed = parseBatchVerdicts(valid, ['a', 'b'])
  assert.deepEqual(parsed.get('a'), { id: 'a', equivalent: true, issues: [] })
  assert.deepEqual(parsed.get('b'), {
    id: 'b',
    equivalent: false,
    issues: ['missing item']
  })
  assert.deepEqual(
    [...parseBatchVerdicts(`\`\`\`json\n${valid}\n\`\`\``, ['a', 'b']).keys()],
    ['a', 'b']
  )

  const results = (items) => JSON.stringify({ results: items })
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: true, issues: [] }]), ['a', 'b']),
    /missing ids: b/
  )
  assert.throws(
    () => parseBatchVerdicts(results([
      { id: 'a', equivalent: true, issues: [] },
      { id: 'a', equivalent: true, issues: [] }
    ]), ['a', 'b']),
    /duplicate ids: a/
  )
  assert.throws(
    () => parseBatchVerdicts(results([
      { id: 'a', equivalent: true, issues: [] },
      { id: 'c', equivalent: true, issues: [] }
    ]), ['a', 'b']),
    /unknown ids/
  )
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: true, issues: [] }]), ['a', 'b']),
    /returned 1 results for 2 items/
  )
  assert.throws(
    () => parseBatchVerdicts(JSON.stringify({ results: [], extra: true }), ['a']),
    /exactly one "results" field/
  )
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: true }]), ['a']),
    /exactly "id", "equivalent", and "issues" fields/
  )
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: false, issues: [] }]), ['a']),
    /provides no issues/
  )
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: true, issues: ['x'] }]), ['a']),
    /also reports issues/
  )
  assert.throws(
    () => parseBatchVerdicts(results([{ id: 'a', equivalent: true, issues: [1] }]), ['a']),
    /non-empty strings/
  )
  assert.throws(() => parseBatchVerdicts('not json', ['a']), /not valid JSON/)
  assert.throws(
    () => parseBatchVerdicts('not-json-secret-value', ['a']),
    (error) => /not valid JSON/.test(error.message) && !error.message.includes('secret-value')
  )
})

test('checker CLI accepts and validates --timeout', () => {
  assert.deepEqual(parseCheckerArgs(['--timeout', '1234']), {
    rootDir: undefined,
    timeoutMs: 1234,
    structureOnly: false,
    help: false
  })
  assert.equal(parseCheckerArgs(['--timeout=250']).timeoutMs, 250)
  assert.equal(parseCheckerArgs(['--structure-only']).structureOnly, true)
  assert.equal(parseCheckerArgs([]).structureOnly, false)
  assert.throws(() => parseCheckerArgs(['--timeout', '0']), /--timeout/)
  assert.throws(() => parseCheckerArgs(['--timeout=abc']), /--timeout/)
  assert.throws(() => parseCheckerArgs(['--timeout', '2147483648']), /--timeout/)
})

test('checker passes its timeout to every model request', async (t) => {
  const rootDir = await basicProject(t)
  const timeouts = []
  const requestModel = async ({ prompt, timeoutMs }) => {
    timeouts.push(timeoutMs)
    return validResult(prompt)
  }
  const result = await checkWithConfig({ rootDir, requestModel, timeoutMs: 4321 })

  assert.deepEqual(result.errors, [])
  assert.ok(timeouts.length >= 1)
  assert.ok(timeouts.length < 6)
  assert.ok(timeouts.every((value) => value === 4321))
})

test('semantic prompts never receive protected code, formulas, or URLs', async (t) => {
  const sentinel = 'AI_SENTINEL_LOCAL_ONLY_7f4c'
  const page = [
    '---',
    `image: /${sentinel}.png`,
    '---',
    '# Home',
    '',
    'Visible page text.',
    '',
    '```js',
    `const codeToken = '${sentinel}'`,
    '```',
    '',
    `    const indented = '${sentinel}'`,
    '',
    `Inline \`${sentinel}\` value.`,
    '',
    `Multi-line \`code`,
    `${sentinel}\` value.`,
    '',
    `$${sentinel}$`,
    '',
    `[label](https://${sentinel}.example/target)`,
    '',
    `[https://${sentinel}.example/label](https://${sentinel}.example/link-target)`,
    '',
    `https://${sentinel}.example/path_(part)/suffix?token=${sentinel}`,
    '',
    `<a href="https://${sentinel}.example/html">visible link</a>`,
    '',
    `<a href=/en/relative/path?token=${sentinel}>relative link</a>`,
    ''
  ].join('\n')
  const chinesePage = page
    .replace('/en/relative/path', '/zh-cn/relative/path')
    .replace('# Home', '# 首页')
    .replace('Visible page text.', '可见页面文字。')
    .replace('Inline ', '行内 ')
    .replace('Multi-line ', '多行 ')
    .replace(' value.', ' 值。')
    .replace('visible link', '可见链接')
    .replace('relative link', '相对链接')
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: page,
    chinese: chinesePage,
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.ok(prompts.length > 0)
  assert.ok(
    !prompts.join('\n').includes(sentinel),
    'protected sentinel reached a model prompt'
  )
  assert.ok(
    !JSON.stringify(result).includes(sentinel),
    'protected sentinel reached checker output'
  )
})

test('a passing check reviews docs and the root README triple with frontmatter', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '---\ntitle: Home\n---\n# Home\n\nWelcome.\n',
    chinese: '---\ntitle: 首页\n---\n# 首页\n\n欢迎。\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 2)
  assert.equal(result.uiChecked, true)
  assert.ok(prompts.length > 0)
  assert.ok(prompts.length < 6)
  assert.deepEqual(prompts.flatMap(batchIds), [
    'page-1-en',
    'page-1-zh-tw',
    'page-2-en',
    'page-2-zh-tw',
    'ui-en',
    'ui-zh-tw'
  ])

  const docsPrompt = prompts.find((prompt) => isEnglishPrompt(prompt))
  const docsTraditionalPrompt = prompts.find((prompt) => isTraditionalPrompt(prompt))
  const readmePrompt = prompts.find((prompt) =>
    prompt.includes('Page pair: README.md vs README.zh-CN.md')
  )
  const joined = prompts.join('\n')

  assert.ok(docsPrompt)
  assert.match(docsPrompt, /title: Home/)
  assert.match(docsPrompt, /title: 首页/)
  assert.match(docsPrompt, /untrusted data/)
  assert.ok(docsTraditionalPrompt)
  assert.match(docsTraditionalPrompt, /欢迎。/)
  assert.match(docsTraditionalPrompt, /歡迎。/)
  assert.match(docsTraditionalPrompt, /untrusted data/)
  assert.ok(readmePrompt)
  assert.match(readmePrompt, /English readme\./)
  assert.match(readmePrompt, /中文说明。/)
  assert.match(joined, /Configuration pair:/)
  assert.match(joined, /English description\./)
  assert.match(joined, /繁體中文描述。/)
  assert.match(joined, /untrusted data/)
})

test('semantic reviews are not cached between check runs', async (t) => {
  const rootDir = await basicProject(t)
  const firstPrompts = []
  const secondPrompts = []

  const first = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, firstPrompts)
  })
  const second = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, secondPrompts)
  })

  assert.deepEqual(first.errors, [])
  assert.deepEqual(second.errors, [])
  assert.equal(first.pairCount, 2)
  assert.equal(second.pairCount, 2)
  assert.ok(firstPrompts.length > 0)
  assert.deepEqual(firstPrompts.flatMap(batchIds), secondPrompts.flatMap(batchIds))
})

test('the root README triple is required', async (t) => {
  const rootDir = await basicProject(t)
  await rm(path.join(rootDir, 'README.zh-TW.md'))
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 1)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
  assert.match(result.errors.join('\n'), /Missing README triple/)
  assert.match(result.errors.join('\n'), /README\.zh-TW\.md/)
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
})

test('any structure error blocks every semantic model request', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nEnglish paragraph.\n',
    chinese: '### 首页\n\n中文段落。\n',
    md
  })
  await addPage(rootDir, 'About/index.md', {
    english: '# About\n',
    chinese: '# 关于\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 3)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
  assert.match(result.errors.join('\n'), /heading levels differ/)
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
  assert.doesNotMatch(result.errors.join('\n'), /阶段二（语义）/)
})

test('phase one rejects mismatched protected code before any model request', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n```js\nconst value = 1\n```\n',
    chinese: '# 首页\n\n```js\nconst value = 2\n```\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.ok(result.errors.some((error) => /本地受保护代码内容不一致/.test(error)))
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
})

test('a false semantic verdict fails with the reported issues', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => batchReply(prompt, (id, block) => (
    block.includes('Page pair: docs/en/index.md vs docs/zh-cn/index.md')
      ? {
          equivalent: false,
          issues: ['The Chinese page omits the external GitHub link.']
        }
      : { equivalent: true, issues: [] }
  ))
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.equal(result.semanticChecked, true)
  assert.match(result.errors[0], /阶段二（语义）/)
  assert.match(result.errors[0], /docs\/en\/index\.md vs docs\/zh-cn\/index\.md: semantic mismatch/)
  assert.match(result.errors[0], /omits the external GitHub link/)
})

test('a README semantic mismatch is reported with its paths', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => batchReply(prompt, (id, block) => (
    block.includes('Page pair: README.md vs README.zh-CN.md')
      ? {
          equivalent: false,
          issues: ['The Chinese README omits the deployment note.']
        }
      : { equivalent: true, issues: [] }
  ))
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /README\.md vs README\.zh-CN\.md: semantic mismatch/)
  assert.match(result.errors[0], /omits the deployment note/)
})

test('visible config comparison detects missing navigation, sidebar, and labels', () => {
  const matching = matchingSiteConfigs()
  assert.deepEqual(
    compareUiConfigurations(
      matching.englishConfig,
      matching.chineseConfig,
      matching.traditionalConfig
    ).errors,
    []
  )

  const missingNav = matchingSiteConfigs()
  missingNav.englishConfig.themeConfig.nav.push({ text: 'About', link: '/en/About/' })
  assert.match(
    compareUiConfigurations(
      missingNav.englishConfig,
      missingNav.chineseConfig,
      missingNav.traditionalConfig
    ).errors.join('\n'),
    /themeConfig\.nav item count differs/
  )

  const missingLabel = matchingSiteConfigs()
  delete missingLabel.traditionalConfig.themeConfig.editLink.text
  assert.match(
    compareUiConfigurations(
      missingLabel.englishConfig,
      missingLabel.chineseConfig,
      missingLabel.traditionalConfig
    ).errors.join('\n'),
    /visible UI field "themeConfig\.editLink\.text" is present in English\/Simplified Chinese but missing in Traditional Chinese/
  )

  const missingSidebarItem = matchingSiteConfigs()
  missingSidebarItem.englishConfig.themeConfig.sidebar['/en/Notes/'] = [
    { text: 'Notes', link: '/en/Notes/', items: [{ text: 'First', link: '/en/Notes/first' }] },
    { text: 'More', link: '/en/Notes/more' }
  ]
  missingSidebarItem.chineseConfig.themeConfig.sidebar['/zh-cn/Notes/'] = [
    { text: '笔记', link: '/zh-cn/Notes/', items: [{ text: '第一篇', link: '/zh-cn/Notes/first' }] }
  ]
  missingSidebarItem.traditionalConfig.themeConfig.sidebar['/zh-tw/Notes/'] = [
    { text: '筆記', link: '/zh-tw/Notes/', items: [{ text: '第一篇', link: '/zh-tw/Notes/first' }] }
  ]
  assert.match(
    compareUiConfigurations(
      missingSidebarItem.englishConfig,
      missingSidebarItem.chineseConfig,
      missingSidebarItem.traditionalConfig
    ).errors.join('\n'),
    /themeConfig\.sidebar\["\/Notes"\] item count differs/
  )
})

test('config links must carry their own locale prefix', () => {
  const configs = matchingSiteConfigs()
  configs.englishConfig.themeConfig.nav[0].link = '/zh-cn/'
  const errors = compareUiConfigurations(
    configs.englishConfig,
    configs.chineseConfig,
    configs.traditionalConfig
  ).errors.join('\n')
  assert.match(errors, /语言前缀与 \/en\/ 不一致/)

  const traditional = matchingSiteConfigs()
  traditional.traditionalConfig.themeConfig.nav[0].link = '/zh-cn/'
  assert.match(
    compareUiConfigurations(
      traditional.englishConfig,
      traditional.chineseConfig,
      traditional.traditionalConfig
    ).errors.join('\n'),
    /语言前缀与 \/zh-tw\/ 不一致/
  )
})

test('a config semantic mismatch is reported with its paths', async (t) => {
  const rootDir = await basicProject(t)
  const siteConfigs = matchingSiteConfigs()
  siteConfigs.traditionalConfig.themeConfig.editLink.text = '刪除此頁'
  const requestModel = async ({ prompt }) => batchReply(prompt, (id, block) => (
    block.includes('Configuration pair:') && block.includes('TRADITIONAL CHINESE UI')
      ? {
          equivalent: false,
          issues: ['The Traditional Chinese edit link says delete instead of edit.']
        }
      : { equivalent: true, issues: [] }
  ))
  const result = await checkWithConfig({
    rootDir,
    loadSiteConfigs: async () => siteConfigs,
    requestModel
  })

  assert.equal(result.errors.length, 1)
  assert.match(
    result.errors[0],
    /docs\/\.vitepress\/en-us\.ts vs docs\/\.vitepress\/zh-cn\.ts vs docs\/\.vitepress\/zh-tw\.ts: semantic mismatch \(Traditional Chinese\)/
  )
  assert.match(result.errors[0], /delete instead of edit/)
})

test('a config semantic failure fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (prompt.includes('Configuration pair:') && prompt.includes('ENGLISH UI')) {
      throw new Error('model service unavailable ENOENT')
    }
    return validResult(prompt)
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /docs\/\.vitepress\/en-us\.ts/)
  assert.match(result.errors[0], /语义批次 \d+\/\d+ 请求失败/)
  assert.match(result.errors[0], /ui-en=/)
  assert.match(result.errors[0], /\(English\)/)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /ENOENT/)
})

test('a config load failure fails and is not silently skipped', async (t) => {
  const rootDir = await basicProject(t)
  const result = await checkWithConfig({
    rootDir,
    loadSiteConfigs: async () => {
      throw new Error('cannot parse VitePress config')
    },
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.equal(result.uiChecked, false)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /unable to load VitePress locale configuration/)
  assert.match(result.errors[0], /cannot parse VitePress config/)
})

test('an unparseable semantic verdict fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) =>
    isEnglishPrompt(prompt) ? 'the batch looks fine' : validResult(prompt)
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /not valid JSON/)
  assert.match(result.errors[0], /语义批次 \d+\/\d+ 请求失败/)
})

test('an authentication failure fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!isEnglishPrompt(prompt)) return validResult(prompt)
    throw new Error('401 Unauthorized: invalid model credentials')
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /401 Unauthorized/)
  assert.match(result.errors[0], /语义批次 \d+\/\d+ 请求失败/)
})

test('a missing model service fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!isEnglishPrompt(prompt)) return validResult(prompt)
    throw new Error('Unable to reach model service: ENOENT')
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /ENOENT/)
})

test('missing locale counterparts fail and are not sent to the model', async (t) => {
  const rootDir = await makeProject(t)
  await mkdir(path.join(rootDir, 'docs/en'), { recursive: true })
  await writeFile(path.join(rootDir, 'docs/en/index.md'), '# Home\n\nWelcome.\n', 'utf8')
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 1)
  assert.equal(result.uiChecked, true)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
  assert.match(result.errors.join('\n'), /Missing zh-cn page: docs\/zh-cn\/index\.md/)
  assert.match(result.errors.join('\n'), /Missing zh-tw page: docs\/zh-tw\/index\.md/)
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
})

test('root Chinese documents are paired with English and Traditional files', async (t) => {
  const chinese = '# 资料\n'
  const rootDir = await makeProject(t, {
    '资料.md': chinese,
    '资料.en.md': '# Notes\n',
    '资料.zh-TW.md': convertTextToTraditional(chinese)
  })
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nWelcome.\n',
    chinese: '# 首页\n\n欢迎。\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 3)
  assert.ok(prompts.some((prompt) => prompt.includes('Page pair: 资料.en.md vs 资料.md')))
  assert.ok(prompts.some((prompt) => prompt.includes('Page pair: 资料.zh-TW.md vs 资料.md')))
})

test('a missing Traditional root document is reported, not silently ignored', async (t) => {
  const rootDir = await makeProject(t, {
    '资料.md': '# 资料\n',
    '资料.en.md': '# Notes\n'
  })
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nWelcome.\n',
    chinese: '# 首页\n\n欢迎。\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.match(result.errors.join('\n'), /Missing Traditional Chinese page: 资料\.zh-TW\.md/)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
})

test('HTML comments and private blocks are never sent to the semantic model', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nEnglish text. <!-- English private note -->\n',
    chinese: [
      '# 首页',
      '',
      '中文文字。<!-- 中文私密注记 -->',
      '',
      '<!-- private:start -->',
      '绝对不能发送的正文。',
      '<!-- private:end -->',
      ''
    ].join('\n'),
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  const joined = prompts.map((entry) => entry).join('\n')
  assert.doesNotMatch(joined, /private note|私密注记|绝对不能发送|private:start|private:end/)
})

test('an unclosed private block fails the check without calling the model for that page', async (t) => {
  const rootDir = await makeProject(t)
  await mkdir(path.join(rootDir, 'docs/en'), { recursive: true })
  await mkdir(path.join(rootDir, 'docs/zh-cn'), { recursive: true })
  await mkdir(path.join(rootDir, 'docs/zh-tw'), { recursive: true })
  await writeFile(path.join(rootDir, 'docs/en/index.md'), '# Home\n\nWelcome.\n', 'utf8')
  await writeFile(
    path.join(rootDir, 'docs/zh-cn/index.md'),
    '# 首页\n\n<!-- private:start -->\n秘密\n',
    'utf8'
  )
  await writeFile(path.join(rootDir, 'docs/zh-tw/index.md'), '# 首頁\n\n歡迎。\n', 'utf8')
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.match(result.errors.join('\n'), /Unclosed private block/)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
  assert.doesNotMatch(prompts.join('\n'), /秘密/)
})

test('a copied Simplified page is rejected as Traditional', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const chinese = '# 首页\n\n这里介绍软件与网络。\n'
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nThis page introduces software and networking.\n',
    chinese,
    traditional: chinese,
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.ok(result.errors.some((error) =>
    /繁中页面仍含未转换的简体内容/.test(error)
  ))
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
})

test('wrong locale link prefixes fail the trilingual check', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n[Notes](/zh-cn/Notes/)\n',
    chinese: '# 首页\n\n[笔记](/zh-cn/Notes/)\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.ok(result.errors.some((error) =>
    /docs\/en\/index\.md: 站内链接 \/zh-cn\/Notes\/ 的语言前缀与 \/en\/ 不一致/.test(error)
  ))
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
})

test('Traditional page structure differences are reported', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nWelcome.\n',
    chinese: '# 首页\n\n欢迎。\n',
    traditional: '# 首頁\n\n### 歡迎。\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.match(result.errors.join('\n'), /docs\/zh-tw\/index\.md vs docs\/zh-cn\/index\.md: heading levels differ/)
  assert.equal(prompts.length, 0)
  assert.equal(result.semanticChecked, false)
})

test('the docs root redirect entry is not part of locale pairing', async (t) => {
  const rootDir = await basicProject(t)
  await writeFile(
    path.join(rootDir, 'docs/index.md'),
    '<script>location.replace("/en/")</script>\n',
    'utf8'
  )
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 2)
})

test('an unexpected English page at the docs root is reported', async (t) => {
  const rootDir = await basicProject(t)
  await writeFile(path.join(rootDir, 'docs/Legacy.md'), '# Legacy\n', 'utf8')
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.match(result.errors.join('\n'), /Unexpected root Markdown page/)
})

test('structure-only completes phase one without any model request', async (t) => {
  const rootDir = await basicProject(t)
  let calls = 0
  const result = await checkMultilingual({
    rootDir,
    loadSiteConfigs: async () => matchingSiteConfigs(),
    structureOnly: true,
    requestModel: async () => {
      calls += 1
      throw new Error('structure-only must not call the model')
    }
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.structureChecked, true)
  assert.equal(result.semanticChecked, false)
  assert.equal(calls, 0)
})

test('a visible UI configuration error blocks every semantic model request', async (t) => {
  const rootDir = await basicProject(t)
  const configs = matchingSiteConfigs()
  delete configs.traditionalConfig.themeConfig.editLink.text
  let calls = 0
  const result = await checkMultilingual({
    rootDir,
    loadSiteConfigs: async () => configs,
    requestModel: async ({ prompt }) => {
      calls += 1
      return validResult(prompt)
    }
  })

  assert.match(
    result.errors.join('\n'),
    /visible UI field "themeConfig\.editLink\.text".*missing in Traditional Chinese/
  )
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
  assert.equal(result.semanticChecked, false)
  assert.equal(calls, 0)
})

test('formula, Mermaid structure, and link-target differences all block the model', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: [
      '# Home',
      '',
      'Formula $x$.',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '[external](https://one.example/path)',
      ''
    ].join('\n'),
    chinese: [
      '# 首页',
      '',
      '公式 $y$。',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: 你好',
      '```',
      '',
      '[外部](https://two.example/path)',
      ''
    ].join('\n'),
    md
  })
  let calls = 0
  const result = await checkMultilingual({
    rootDir,
    loadSiteConfigs: async () => matchingSiteConfigs(),
    requestModel: async ({ prompt }) => {
      calls += 1
      return validResult(prompt)
    }
  })

  const errors = result.errors.join('\n')
  assert.match(errors, /本地受保护公式内容不一致/)
  assert.match(errors, /链接目标或 URL\s*不一致/)
  assert.match(errors, /本地受保护Mermaid 结构不一致/)
  assert.match(errors, /阶段一（结构）/)
  assert.equal(result.semanticChecked, false)
  assert.equal(calls, 0)
})

test('a config load failure blocks every semantic model request', async (t) => {
  const rootDir = await basicProject(t)
  const prompts = []
  const result = await checkMultilingual({
    rootDir,
    loadSiteConfigs: async () => {
      throw new Error('cannot parse VitePress config')
    },
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.uiChecked, false)
  assert.match(result.errors.join('\n'), /unable to load VitePress locale configuration/)
  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
})

test('a successful check reviews each page pair and each UI pair exactly once', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\nWelcome.\n',
    chinese: '# 首页\n\n欢迎。\n',
    md
  })
  await addPage(rootDir, 'About/index.md', {
    english: '# About\n\nProfile.\n',
    chinese: '# 关于\n\n简介。\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 3)
  assert.equal(result.semanticChecked, true)
  const ids = prompts.flatMap(batchIds)
  assert.deepEqual(ids, [
    'page-1-en',
    'page-1-zh-tw',
    'page-2-en',
    'page-2-zh-tw',
    'page-3-en',
    'page-3-zh-tw',
    'ui-en',
    'ui-zh-tw'
  ])
  assert.equal(new Set(ids).size, ids.length)
  const joined = prompts.join('\n')
  assert.equal((joined.match(/Page pair:/g) ?? []).length, 6)
  assert.equal((joined.match(/Configuration pair:/g) ?? []).length, 2)
  assert.ok(prompts.some((prompt) => isEnglishPrompt(prompt, 'About/index.md')))
  assert.ok(prompts.some((prompt) => isTraditionalPrompt(prompt, 'About/index.md')))
})

test('different nested list item counts block every semantic model request', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n- First\n  - A\n  - B\n- Second\n',
    chinese: '# 首页\n\n- 第一\n  - 甲\n- 第二\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  const errors = result.errors.join('\n')
  assert.match(errors, /content block structure differs/)
  assert.match(errors, /child block count/)
  assert.match(errors, /阶段一（结构）/)
  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
})

test('list-item paragraph and blockquote position differences block the model', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n- First\n\n  > Quoted note\n\n- Second\n',
    chinese: '# 首页\n\n- 第一\n\n  引用文字。\n\n- 第二\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  const errors = result.errors.join('\n')
  assert.match(errors, /content block structure differs/)
  assert.match(errors, /blockquote/)
  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
})

test('a table row with fewer cells blocks every semantic model request', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    chinese: '# 首页\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 |\n',
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  const errors = result.errors.join('\n')
  assert.match(errors, /table row widths differ/)
  assert.match(errors, /阶段一（结构）/)
  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
})

test('phase two batches every page and UI pair within limits without omission', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  for (let index = 0; index < 7; index += 1) {
    await addPage(rootDir, `Topic${index}/index.md`, {
      english: `# Topic ${index}\n\nVisible profile ${index}.\n`,
      chinese: `# 主题 ${index}\n\n可见简介 ${index}。\n`,
      md
    })
  }
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 8)
  const ids = prompts.flatMap(batchIds)
  assert.equal(ids.length, 8 * 2 + 2)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(
    [...ids].sort(),
    [
      'ui-en',
      'ui-zh-tw',
      ...Array.from({ length: 8 }, (_, index) => [
        `page-${index + 1}-en`,
        `page-${index + 1}-zh-tw`
      ]).flat()
    ].sort()
  )
  assert.ok(prompts.length > 1)
  assert.ok(prompts.length < ids.length)
  assert.ok(
    prompts.every((prompt) => batchIds(prompt).length <= semanticBatchLimits.maxItems)
  )
})

test('phase two splits the byte budget without dropping a large pair', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  for (let index = 0; index < 2; index += 1) {
    await addPage(rootDir, `Large${index}/index.md`, {
      english: `# Large ${index}\n\n${'Visible paragraph text. '.repeat(150)}\n`,
      chinese: `# 大型 ${index}\n\n${'可见段落文字。'.repeat(150)}\n`,
      md
    })
  }
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  const largePrompts = prompts.filter((prompt) =>
    batchIds(prompt).some((id) => /^page-[12]-(en|zh-tw)$/.test(id))
  )
  for (const prompt of largePrompts) {
    const largeIds = batchIds(prompt).filter((id) => /^page-[12]-(en|zh-tw)$/.test(id))
    assert.equal(largeIds.length, 1, 'two large pairs must not share a batch')
    assert.ok(batchIds(prompt).length <= semanticBatchLimits.maxItems)
  }
  assert.equal(largePrompts.length, 4)
})

test('a 429 batch failure reports every involved item and is not retried', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  for (let index = 0; index < 7; index += 1) {
    await addPage(rootDir, `Failure${index}/index.md`, {
      english: `# Failure ${index}\n\nVisible text ${index}.\n`,
      chinese: `# 失败 ${index}\n\n可见文字 ${index}。\n`,
      md
    })
  }
  const calls = []
  const requestModel = async ({ prompt }) => {
    const ids = batchIds(prompt)
    calls.push(ids)
    if (calls.length === 1) {
      throw new Error('429 Too Many Requests: rate limit exceeded')
    }
    return batchReply(prompt)
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.semanticChecked, true)
  assert.ok(calls.length >= 2)
  const seen = calls.flat()
  assert.equal(new Set(seen).size, seen.length, 'a failed batch must not be retried')
  assert.equal(result.semanticErrors.length, 1)
  const failure = result.errors.join('\n')
  assert.match(failure, /语义批次 1\/\d+ 请求失败，涉及条目：/)
  assert.match(failure, /429 Too Many Requests/)
  for (const id of calls[0]) {
    assert.match(failure, new RegExp(`${id}=`))
  }
})

test('malformed batch ids fail the implicated batch without inventing verdicts', async (t) => {
  const cases = [
    ['missing', 'missing ids:'],
    ['duplicate', 'duplicate ids:'],
    ['unknown', 'unknown ids:']
  ]
  for (const [mode, expected] of cases) {
    await t.test(mode, async (t) => {
      const rootDir = await basicProject(t)
      let calls = 0
      const requestModel = async ({ prompt }) => {
        calls += 1
        if (calls > 1) return batchReply(prompt)
        const ids = batchIds(prompt)
        const results = ids.map((id) => ({ id, equivalent: true, issues: [] }))
        if (mode === 'missing') {
          results.pop()
        } else if (mode === 'duplicate') {
          results[results.length - 1] = { ...results[0] }
        } else {
          results[results.length - 1] = {
            id: 'unknown-item',
            equivalent: true,
            issues: []
          }
        }
        return JSON.stringify({ results })
      }
      const result = await checkWithConfig({ rootDir, requestModel })

      assert.equal(result.semanticChecked, true)
      assert.equal(result.semanticErrors.length, 1)
      const failure = result.errors.join('\n')
      assert.match(failure, /语义批次 1\/\d+ 请求失败，涉及条目：/)
      assert.match(failure, new RegExp(expected))
    })
  }
})

test('a document larger than the multi-item budget is reviewed on its own', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: `# Home\n\n${'Visible documentation. '.repeat(700)}\n`,
    chinese: `# 首页\n\n${'可见说明。'.repeat(700)}\n`,
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })
  assert.deepEqual(result.errors, [])
  for (const id of ['page-1-en', 'page-1-zh-tw']) {
    const prompt = prompts.find((value) => batchIds(value).includes(id))
    assert.ok(prompt, `missing semantic review for ${id}`)
    assert.deepEqual(batchIds(prompt), [id])
  }
})

test('a projected item above the byte cap fails explicitly without a model request', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: `# Home\n\n${'OVERSIZED_SENTINEL '.repeat(Math.ceil(semanticBatchLimits.maxItemBytes / 18))}\n`,
    chinese: `# 首页\n\n${'超长可见文字。'.repeat(Math.ceil(semanticBatchLimits.maxItemBytes / 18))}\n`,
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.semanticChecked, true)
  const errors = result.errors.join('\n')
  assert.match(errors, /语义检查单项过大/)
  assert.match(errors, new RegExp(`安全上限 ${semanticBatchLimits.maxItemBytes} 字节`))
  assert.match(errors, /未发送模型/)
  assert.match(errors, /docs\/en\/index\.md vs docs\/zh-cn\/index\.md/)
  assert.match(errors, /docs\/zh-tw\/index\.md vs docs\/zh-cn\/index\.md/)
  assert.ok(prompts.length > 0)
  assert.doesNotMatch(prompts.join('\n'), /OVERSIZED_SENTINEL/)
})

test('hard links to the protected model config block docs and README with zero model calls', async (t) => {
  for (const relative of ['docs/en/index.md', 'README.md']) {
    await t.test(relative, async (t) => {
      const rootDir = await basicProject(t)
      const configPath = path.join(rootDir, 'tools', 'config.yaml')
      const sentinel = 'FAKE_PRIVATE_CONFIG_SENTINEL_9c41'
      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(configPath, `apiKey: ${sentinel}\n`, 'utf8')
      const target = path.join(rootDir, ...relative.split('/'))
      await rm(target)
      await link(configPath, target)

      const prompts = []
      const result = await checkWithConfig({
        rootDir,
        requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
      })

      assert.equal(result.semanticChecked, false)
      assert.equal(prompts.length, 0)
      assert.match(result.errors.join('\n'), /无法安全读取 Markdown 源文件/)
      assert.match(result.errors.join('\n'), /阶段一（结构）/)
      assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel))
    })
  }
})

test('a symbolic link to the protected model config blocks phase one and all model calls', async (t) => {
  const rootDir = await basicProject(t)
  const configPath = path.join(rootDir, 'tools', 'config.yaml')
  const sentinel = 'FAKE_PRIVATE_CONFIG_SENTINEL_5a72'
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `apiKey: ${sentinel}\n`, 'utf8')
  const readmePath = path.join(rootDir, 'README.md')
  await rm(readmePath)
  try {
    await symlink(configPath, readmePath, 'file')
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN', 'EINVAL', 'ENOSYS'].includes(error.code)) {
      t.skip(`symbolic links are unavailable: ${error.code}`)
      return
    }
    throw error
  }

  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
  assert.match(result.errors.join('\n'), /无法安全读取 Markdown 源文件/)
  assert.match(result.errors.join('\n'), /阶段一（结构）/)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sentinel))
})

test('homepage frontmatter array and visible-key differences block the model', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  const englishFrontmatter = [
    '---',
    'layout: home',
    'hero:',
    '  name: Home',
    '  actions:',
    '    - text: One',
    '      link: /en/One/',
    '    - text: Two',
    '      link: /en/Two/',
    'features:',
    '  - title: A',
    '    details: B',
    '    link: /en/A/',
    '    linkText: Open',
    '---'
  ].join('\n')
  const chineseFrontmatter = [
    '---',
    'layout: home',
    'hero:',
    '  name: 首页',
    '  actions:',
    '    - text: 一',
    '      link: /zh-cn/One/',
    'features:',
    '  - title: 甲',
    '    details: 乙',
    '    link: /zh-cn/A/',
    '---'
  ].join('\n')
  await addPage(rootDir, 'index.md', {
    english: `${englishFrontmatter}\n# Home\n\nWelcome.\n`,
    chinese: `${chineseFrontmatter}\n# 首页\n\n欢迎。\n`,
    md
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  const errors = result.errors.join('\n')
  assert.match(
    errors,
    /首页可见 frontmatter hero\.actions 数组项数不一致/
  )
  assert.match(
    errors,
    /首页可见 frontmatter features\[0\]\.linkText 在 Simplified Chinese 中缺失/
  )
  assert.match(errors, /阶段一（结构）/)
  assert.equal(result.semanticChecked, false)
  assert.equal(prompts.length, 0)
})

