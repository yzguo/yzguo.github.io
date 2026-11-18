import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  analyzeMarkdown,
  checkBilingual,
  compareStructures,
  compareUiConfigurations,
  getMarkdownParser,
  parseCheckerArgs,
  parseVerdict
} from './check-bilingual.mjs'
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

function successfulRequest(verdict, seen = []) {
  return async ({ prompt }) => {
    seen.push(prompt)
    return JSON.stringify(verdict)
  }
}

function validResult() {
  return '{"equivalent":true,"issues":[]}'
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
  return checkBilingual({
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

test('checker CLI accepts and validates --timeout', () => {
  assert.deepEqual(parseCheckerArgs(['--timeout', '1234']), {
    rootDir: undefined,
    timeoutMs: 1234,
    help: false
  })
  assert.equal(parseCheckerArgs(['--timeout=250']).timeoutMs, 250)
  assert.throws(() => parseCheckerArgs(['--timeout', '0']), /--timeout/)
  assert.throws(() => parseCheckerArgs(['--timeout=abc']), /--timeout/)
  assert.throws(() => parseCheckerArgs(['--timeout', '2147483648']), /--timeout/)
})

test('checker passes its timeout to every model request', async (t) => {
  const rootDir = await basicProject(t)
  const timeouts = []
  const requestModel = async ({ timeoutMs }) => {
    timeouts.push(timeoutMs)
    return validResult()
  }
  const result = await checkWithConfig({ rootDir, requestModel, timeoutMs: 4321 })

  assert.deepEqual(result.errors, [])
  assert.ok(timeouts.length >= 6)
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
  assert.equal(prompts.length, 6)

  const docsPrompt = prompts.find((prompt) => isEnglishPrompt(prompt))
  const docsTraditionalPrompt = prompts.find((prompt) => isTraditionalPrompt(prompt))
  const readmePrompt = prompts.find((prompt) =>
    prompt.includes('Page pair: README.md vs README.zh-CN.md')
  )
  const configPrompts = prompts.filter((prompt) => prompt.includes('Configuration pair:'))

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
  assert.equal(configPrompts.length, 2)
  assert.ok(configPrompts.some((prompt) => prompt.includes('English description.')))
  assert.ok(configPrompts.some((prompt) => prompt.includes('繁體中文描述。')))
  assert.match(configPrompts[0], /untrusted data/)
})

test('semantic reviews are not cached between check runs', async (t) => {
  const rootDir = await basicProject(t)
  const prompts = []
  const requestModel = successfulRequest({ equivalent: true, issues: [] }, prompts)

  const first = await checkWithConfig({ rootDir, requestModel })
  const second = await checkWithConfig({ rootDir, requestModel })

  assert.deepEqual(first.errors, [])
  assert.deepEqual(second.errors, [])
  assert.equal(first.pairCount, 2)
  assert.equal(second.pairCount, 2)
  assert.equal(prompts.length, 12)
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
  assert.equal(prompts.length, 4)
  assert.match(result.errors.join('\n'), /Missing README triple/)
  assert.match(result.errors.join('\n'), /README\.zh-TW\.md/)
})

test('semantic review still runs on every triple when structure checks fail', async (t) => {
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
  assert.equal(prompts.length, 8)
  assert.match(result.errors.join('\n'), /heading levels differ/)
  assert.doesNotMatch(result.errors.join('\n'), /semantic review failed/)
})

test('semantic review rejects mismatched protected content locally', async (t) => {
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
  assert.ok(!prompts.some((prompt) => isEnglishPrompt(prompt)))
})

test('a false semantic verdict fails with the reported issues', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!isEnglishPrompt(prompt)) return validResult()
    return JSON.stringify({
      equivalent: false,
      issues: ['The Chinese page omits the external GitHub link.']
    })
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /docs\/en\/index\.md vs docs\/zh-cn\/index\.md: semantic mismatch/)
  assert.match(result.errors[0], /omits the external GitHub link/)
})

test('a README semantic mismatch is reported with its paths', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!prompt.includes('Page pair: README.md vs README.zh-CN.md')) return validResult()
    return JSON.stringify({
      equivalent: false,
      issues: ['The Chinese README omits the deployment note.']
    })
  }
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
  const requestModel = async ({ prompt }) => {
    if (prompt.includes('Configuration pair:') && prompt.includes('TRADITIONAL CHINESE UI')) {
      return JSON.stringify({
        equivalent: false,
        issues: ['The Traditional Chinese edit link says delete instead of edit.']
      })
    }
    return validResult()
  }
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
    return validResult()
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /docs\/\.vitepress\/en-us\.ts/)
  assert.match(result.errors[0], /semantic review \(English\) failed/)
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
    isEnglishPrompt(prompt) ? '{"equivalent":true}' : validResult()
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /issues/)
})

test('an authentication failure fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!isEnglishPrompt(prompt)) return validResult()
    throw new Error('401 Unauthorized: invalid model credentials')
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /401 Unauthorized/)
})

test('a missing model service fails the check', async (t) => {
  const rootDir = await basicProject(t)
  const requestModel = async ({ prompt }) => {
    if (!isEnglishPrompt(prompt)) return validResult()
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
  assert.equal(prompts.length, 4)
  assert.ok(prompts.some((prompt) => /Page pair: README\.md vs README\.zh-CN\.md/.test(prompt)))
  assert.doesNotMatch(prompts.join('\n'), /docs\/en\/index\.md/)
  assert.match(result.errors.join('\n'), /Missing zh-cn page: docs\/zh-cn\/index\.md/)
  assert.match(result.errors.join('\n'), /Missing zh-tw page: docs\/zh-tw\/index\.md/)
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
  assert.doesNotMatch(prompts.join('\n'), /资料\.md/)
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
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.ok(result.errors.some((error) =>
    /繁中页面仍含未转换的简体内容/.test(error)
  ))
})

test('wrong locale link prefixes fail the trilingual check', async (t) => {
  const rootDir = await makeProject(t)
  const md = await parser(rootDir)
  await addPage(rootDir, 'index.md', {
    english: '# Home\n\n[Notes](/zh-cn/Notes/)\n',
    chinese: '# 首页\n\n[笔记](/zh-cn/Notes/)\n',
    md
  })
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.ok(result.errors.some((error) =>
    /docs\/en\/index\.md: 站内链接 \/zh-cn\/Notes\/ 的语言前缀与 \/en\/ 不一致/.test(error)
  ))
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
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] })
  })

  assert.match(result.errors.join('\n'), /docs\/zh-tw\/index\.md vs docs\/zh-cn\/index\.md: heading levels differ/)
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
