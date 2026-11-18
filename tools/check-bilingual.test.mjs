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

const defaultReadme = {
  'README.md': '# Project\n\nEnglish readme.\n',
  'README.zh-CN.md': '# 项目\n\n中文说明。\n'
}

async function makeProject(t, files = {}, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'bilingual-check-'))
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

async function parser(t) {
  const rootDir = await makeProject(t, {})
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

function matchingSiteConfigs() {
  const englishTheme = {
    nav: [{ text: 'Home', link: '/' }],
    sidebar: { '/': [{ text: 'Home', link: '/' }] },
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
    nav: [{ text: '首页', link: '/' }],
    sidebar: { '/': [{ text: '首页', link: '/' }] },
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
    errors: []
  }
}

function checkWithConfig(options) {
  return checkBilingual({
    loadSiteConfigs: async () => matchingSiteConfigs(),
    ...options
  })
}

function isDocsIndexPrompt(prompt) {
  return prompt.includes('Page pair: docs/index.md vs docs/zh-cn/index.md')
}

test('Markdown structure ignores headings and comments inside fenced code', async (t) => {
  const md = await parser(t)
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
  const md = await parser(t)
  const english = analyzeMarkdown('# Example\n\n```python\n# comment\nprint(1)\n```\n', md)
  const chinese = analyzeMarkdown('# 示例\n\n```python\n# 注释\nprint(1)\n```\n', md)

  assert.deepEqual(
    compareStructures('docs/demo.md', 'docs/zh-cn/demo.md', english, chinese),
    []
  )
})

test('HTML comments do not affect visible structure', async (t) => {
  const md = await parser(t)
  const english = analyzeMarkdown('# Title\n\n<!-- editorial note -->\n\nA paragraph.\n', md)
  const chinese = analyzeMarkdown('# 标题\n\n一段文字。\n', md)

  assert.deepEqual(
    compareStructures('docs/demo.md', 'docs/zh-cn/demo.md', english, chinese),
    []
  )
})

test('real heading, code block, and table differences are reported', async (t) => {
  const md = await parser(t)
  const english = analyzeMarkdown(
    '# Title\n\n## Section\n\n```js\nconst value = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    md
  )
  const chinese = analyzeMarkdown(
    '# 标题\n\n### 部分\n\n```ts\nconst value = 1\n```\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n',
    md
  )

  const errors = compareStructures('docs/demo.md', 'docs/zh-cn/demo.md', english, chinese).join('\n')
  assert.match(errors, /heading levels differ/)
  assert.match(errors, /code blocks differ/)
  assert.match(errors, /table shapes differ/)
  assert.match(errors, /docs\/demo\.md/)
})

test('block-level content structure differences are reported', async (t) => {
  const md = await parser(t)
  const english = analyzeMarkdown('# Title\n\nA paragraph.\n', md)
  const chinese = analyzeMarkdown('# 标题\n\n> 一段引用。\n', md)

  const errors = compareStructures('docs/demo.md', 'docs/zh-cn/demo.md', english, chinese)
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
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const timeouts = []
  const requestModel = async ({ timeoutMs }) => {
    timeouts.push(timeoutMs)
    return validResult()
  }
  const result = await checkWithConfig({ rootDir, requestModel, timeoutMs: 4321 })

  assert.deepEqual(result.errors, [])
  assert.ok(timeouts.length >= 2)
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
    `<a href=/relative/path?token=${sentinel}>relative link</a>`,
    ''
  ].join('\n')
  const chinesePage = page
    .replace('# Home', '# 首页')
    .replace('Visible page text.', '可见页面文字。')
    .replace('Inline ', '行内 ')
    .replace('Multi-line ', '多行 ')
    .replace(' value.', ' 值。')
    .replace('visible link', '可见链接')
    .replace('relative link', '相对链接')
  const rootDir = await makeProject(t, {
    'docs/index.md': page,
    'docs/zh-cn/index.md': chinesePage
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

test('a passing check reviews docs and the root README pair with frontmatter', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '---\ntitle: Home\n---\n# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '---\ntitle: 首页\n---\n# 首页\n\n欢迎。\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 2)
  assert.equal(result.uiChecked, true)
  assert.equal(prompts.length, 3)

  const docsPrompt = prompts.find((prompt) => isDocsIndexPrompt(prompt))
  const readmePrompt = prompts.find((prompt) =>
    prompt.includes('Page pair: README.md vs README.zh-CN.md')
  )
  const configPrompt = prompts.find((prompt) =>
    prompt.includes('Configuration pair: docs/.vitepress/en-us.ts vs docs/.vitepress/zh-cn.ts')
  )

  assert.ok(docsPrompt)
  assert.match(docsPrompt, /title: Home/)
  assert.match(docsPrompt, /title: 首页/)
  assert.match(docsPrompt, /untrusted data/)
  assert.ok(readmePrompt)
  assert.match(readmePrompt, /English readme\./)
  assert.match(readmePrompt, /中文说明。/)
  assert.ok(configPrompt)
  assert.match(configPrompt, /"themeConfig\.nav"/)
  assert.match(configPrompt, /untrusted data/)
})

test('semantic reviews are not cached between check runs', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const prompts = []
  const requestModel = successfulRequest({ equivalent: true, issues: [] }, prompts)

  const first = await checkWithConfig({ rootDir, requestModel })
  const second = await checkWithConfig({ rootDir, requestModel })

  assert.deepEqual(first.errors, [])
  assert.deepEqual(second.errors, [])
  assert.equal(first.pairCount, 2)
  assert.equal(second.pairCount, 2)
  assert.equal(prompts.length, 6)
})

test('the root README pair is required', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  }, { includeReadme: false })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 1)
  assert.equal(prompts.length, 2)
  assert.match(result.errors.join('\n'), /Missing README pair/)
})

test('semantic review still runs on every pair when structure checks fail', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nEnglish paragraph.\n',
    'docs/zh-cn/index.md': '### 首页\n\n中文段落。\n',
    'docs/About/index.md': '# About\n',
    'docs/zh-cn/About/index.md': '# 关于\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 3)
  assert.equal(prompts.length, 4)
  assert.match(result.errors.join('\n'), /heading levels differ/)
  assert.doesNotMatch(result.errors.join('\n'), /semantic review failed/)
})

test('semantic review rejects mismatched protected content locally', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\n```js\nconst value = 1\n```\n',
    'docs/zh-cn/index.md': '# 首页\n\n```js\nconst value = 2\n```\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.ok(result.errors.some((error) => /本地受保护代码内容不一致/.test(error)))
  assert.ok(!prompts.some((prompt) => isDocsIndexPrompt(prompt)))
})

test('a false semantic verdict fails with the reported issues', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const requestModel = async ({ prompt }) => {
    if (!isDocsIndexPrompt(prompt)) return validResult()
    return JSON.stringify({
      equivalent: false,
      issues: ['The Chinese page omits the external GitHub link.']
    })
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /docs\/index\.md vs docs\/zh-cn\/index\.md: semantic mismatch/)
  assert.match(result.errors[0], /omits the external GitHub link/)
})

test('a README semantic mismatch is reported with its paths', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
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
    compareUiConfigurations(matching.englishConfig, matching.chineseConfig).errors,
    []
  )

  const missingNav = matchingSiteConfigs()
  missingNav.englishConfig.themeConfig.nav.push({ text: 'About', link: '/About/' })
  assert.match(
    compareUiConfigurations(missingNav.englishConfig, missingNav.chineseConfig).errors.join('\n'),
    /themeConfig\.nav item count differs/
  )

  const missingLabel = matchingSiteConfigs()
  delete missingLabel.chineseConfig.themeConfig.editLink.text
  assert.match(
    compareUiConfigurations(missingLabel.englishConfig, missingLabel.chineseConfig).errors.join('\n'),
    /visible UI field "themeConfig\.editLink\.text" is present in English but missing in Chinese/
  )

  const missingSidebarItem = matchingSiteConfigs()
  missingSidebarItem.englishConfig.themeConfig.sidebar['/Notes/'] = [
    { text: 'Notes', link: '/Notes/', items: [{ text: 'First', link: '/Notes/first' }] },
    { text: 'More', link: '/Notes/more' }
  ]
  missingSidebarItem.chineseConfig.themeConfig.sidebar['/Notes/'] = [
    { text: '笔记', link: '/Notes/', items: [{ text: '第一篇', link: '/Notes/first' }] }
  ]
  assert.match(
    compareUiConfigurations(
      missingSidebarItem.englishConfig,
      missingSidebarItem.chineseConfig
    ).errors.join('\n'),
    /themeConfig\.sidebar\["\/Notes"\] item count differs/
  )
})

test('a config semantic mismatch is reported with its paths', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const siteConfigs = matchingSiteConfigs()
  siteConfigs.chineseConfig.themeConfig.editLink.text = '删除此页'
  const requestModel = async ({ prompt }) => {
    if (prompt.includes('Configuration pair: docs/.vitepress/en-us.ts vs docs/.vitepress/zh-cn.ts')) {
      return JSON.stringify({
        equivalent: false,
        issues: ['The Chinese edit link says delete instead of edit.']
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
    /docs\/\.vitepress\/en-us\.ts vs docs\/\.vitepress\/zh-cn\.ts: semantic mismatch/
  )
  assert.match(result.errors[0], /delete instead of edit/)
})

test('a config semantic failure fails the check', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const requestModel = async ({ prompt }) => {
    if (prompt.includes('Configuration pair: docs/.vitepress/en-us.ts vs docs/.vitepress/zh-cn.ts')) {
      throw new Error('model service unavailable ENOENT')
    }
    return validResult()
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /docs\/\.vitepress\/en-us\.ts vs docs\/\.vitepress\/zh-cn\.ts/)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /ENOENT/)
})

test('a config load failure fails and is not silently skipped', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
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
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const requestModel = async ({ prompt }) =>
    isDocsIndexPrompt(prompt) ? '{"equivalent":true}' : validResult()
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /issues/)
})

test('an authentication failure fails the check', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const requestModel = async ({ prompt }) => {
    if (!isDocsIndexPrompt(prompt)) return validResult()
    throw new Error('401 Unauthorized: invalid model credentials')
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /401 Unauthorized/)
})

test('a missing model service fails the check', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n'
  })
  const requestModel = async ({ prompt }) => {
    if (!isDocsIndexPrompt(prompt)) return validResult()
    throw new Error('Unable to reach model service: ENOENT')
  }
  const result = await checkWithConfig({ rootDir, requestModel })

  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /无法调用模型/)
  assert.match(result.errors[0], /ENOENT/)
})

test('missing locale counterparts fail and are not sent to the model', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.equal(result.pairCount, 1)
  assert.equal(result.uiChecked, true)
  assert.equal(prompts.length, 2)
  assert.ok(prompts.some((prompt) => /Page pair: README\.md vs README\.zh-CN\.md/.test(prompt)))
  assert.doesNotMatch(prompts.join('\n'), /docs\/index\.md/)
  assert.match(result.errors.join('\n'), /Missing Chinese page: docs\/zh-cn\/index\.md/)
})

test('root Chinese documents are paired with explicit English files', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n',
    '资料.md': '# 资料\n',
    '资料.en.md': '# Notes\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.pairCount, 3)
  assert.ok(prompts.some((prompt) => prompt.includes('Page pair: 资料.en.md vs 资料.md')))
})

test('a missing English root document is reported, not silently ignored', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n欢迎。\n',
    '资料.md': '# 资料\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.match(result.errors.join('\n'), /Missing English page: 资料\.en\.md/)
  assert.doesNotMatch(prompts.join('\n'), /资料\.md/)
})

test('HTML comments and private blocks are never sent to the semantic model', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nEnglish text. <!-- English private note -->\n',
    'docs/zh-cn/index.md': [
      '# 首页',
      '',
      '中文文字。<!-- 中文私密注记 -->',
      '',
      '<!-- private:start -->',
      '绝对不能发送的正文。',
      '<!-- private:end -->',
      ''
    ].join('\n')
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

test('an unclosed private block fails the check without calling the model for that pair', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/index.md': '# Home\n\nWelcome.\n',
    'docs/zh-cn/index.md': '# 首页\n\n<!-- private:start -->\n秘密\n'
  })
  const prompts = []
  const result = await checkWithConfig({
    rootDir,
    requestModel: successfulRequest({ equivalent: true, issues: [] }, prompts)
  })

  assert.match(result.errors.join('\n'), /Unclosed private block/)
  assert.doesNotMatch(prompts.join('\n'), /秘密/)
})
