import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getMarkdownParser } from './check-bilingual.mjs'
import { collectTranslationSources, main, translateSource, writeTranslationsAtomically } from './translate-docs.mjs'

const dictionary = new Map([
  ['标题', 'Title'],
  ['副标题', 'Subtitle'],
  ['欢迎', 'Welcome'],
  ['第一段', 'First paragraph.'],
  ['第二段', 'Second paragraph.'],
  ['博客', 'Blogs'],
  ['关于', 'About'],
  ['第一项', 'First item'],
  ['第二项', 'Second item'],
  ['正文', 'Body'],
  ['中文说明', 'Chinese notes.'],
  ['链接', 'Link'],
  ['名称', 'Name'],
  ['代码', 'Code'],
  ['说明', 'Description'],
  ['结尾段落', 'Closing paragraph.'],
  ['根文档', 'Root document.'],
  ['小角度', 'Small angle'],
  ['运动方程', 'Equation of motion'],
  ['周期 T', 'Period T']
])

function fakeModel(options = {}) {
  const prompts = []
  async function requestModel({ system, prompt }) {
    prompts.push({ system, prompt })
    if (prompt.includes('strict bilingual content reviewer')) {
      if (options.semanticError) throw new Error(options.semanticError)
      return JSON.stringify(options.verdict ?? { equivalent: true, issues: [] })
    }
    if (prompt.includes('Translate each Chinese string')) {
      if (options.frontmatterError) throw new Error(options.frontmatterError)
      const match = prompt.match(/<<<FRONTMATTER VALUES [^>]+>>>\n([\s\S]*?)\n<<<END/)
      if (!match) throw new Error('missing frontmatter values')
      const values = JSON.parse(match[1])
      if (options.frontmatterResponse) return options.frontmatterResponse(values)
      return JSON.stringify(values.map((value) => {
        for (const [chinese, english] of dictionary) {
          if (value.includes(chinese)) return value.replaceAll(chinese, english)
        }
        return value
      }))
    }
    if (prompt.includes('Translate each Chinese reader-visible label in this Mermaid')) {
      if (options.mermaidError) throw new Error(options.mermaidError)
      const match = prompt.match(/<<<MERMAID LABELS [^>]+>>>\n([\s\S]*?)\n<<<END/)
      if (!match) throw new Error('missing Mermaid labels')
      const values = JSON.parse(match[1])
      if (options.mermaidResponse) return options.mermaidResponse(values)
      return JSON.stringify(values.map((value) => {
        for (const [chinese, english] of dictionary) {
          if (value.includes(chinese)) return value.replaceAll(chinese, english)
        }
        return value
      }))
    }
    if (prompt.includes('<<<TEXT FRAGMENTS')) {
      if (options.bodyError) throw new Error(options.bodyError)
      const match = prompt.match(/<<<TEXT FRAGMENTS [^>]+>>>\n([\s\S]*?)\n<<<END/)
      if (!match) throw new Error('missing text fragments')
      const segments = JSON.parse(match[1])
      const translated = []
      for (const segment of segments) {
        for (const fragment of segment.fragments) {
          let text = fragment.text
          if (options.batchResponse) {
            text = options.batchResponse(text, fragment.id)
          } else if (options.bodyResponse) {
            text = options.bodyResponse(text)
          } else {
            for (const [chinese, english] of dictionary) {
              text = text.replaceAll(chinese, english)
            }
          }
          translated.push({ id: fragment.id, text })
        }
      }
      if (options.batchRawResponse) return options.batchRawResponse(translated)
      return JSON.stringify(translated)
    }
    if (prompt.includes('Translate the Chinese Markdown body')) {
      if (options.bodyError) throw new Error(options.bodyError)
      const match = prompt.match(/<<<CHINESE MARKDOWN BODY [^>]+>>>\n([\s\S]*?)\n<<<END/)
      if (!match) throw new Error('missing body')
      let body = match[1]
      if (options.bodyResponse) return options.bodyResponse(body)
      for (const [chinese, english] of dictionary) {
        body = body.replaceAll(chinese, english)
      }
      return body
    }
    throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`)
  }
  return { requestModel, prompts }
}

async function makeProject(t, files = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'omp-translate-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  const defaults = {
    'README.md': '# Manual English\n\nDo not overwrite.\n',
    'README.zh-CN.md': '# 中文说明\n\n中文说明。\n'
  }
  for (const [relative, content] of Object.entries({ ...defaults, ...files })) {
    const target = path.join(rootDir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await mkdir(path.join(rootDir, 'docs', 'zh-cn'), { recursive: true })
  return rootDir
}

async function parserFor(rootDir) {
  return getMarkdownParser(path.join(rootDir, 'docs'))
}

test('translation sources cover docs, README, and root Chinese documents only', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n',
    'docs/zh-cn/Blogs/demo.md': '# 博客\n\n正文。\n',
    'docs/index.md': '# Existing English\n',
    'English.md': '# English page\n\n提到了中文专名。\n',
    '网站问题排查与优化方案.md': '# 根文档\n'
  })

  const collection = await collectTranslationSources(rootDir)
  assert.deepEqual(collection.errors, [])
  assert.deepEqual(
    collection.sources.map((source) => [source.sourcePath, source.targetPath]),
    [
      ['README.zh-CN.md', 'README.md'],
      ['docs/zh-cn/Blogs/demo.md', 'docs/Blogs/demo.md'],
      ['docs/zh-cn/index.md', 'docs/index.md'],
      ['网站问题排查与优化方案.md', '网站问题排查与优化方案.en.md']
    ]
  )
})

test('generated English preserves code, math, links, and never includes private notes', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': [
      '---',
      'title: 标题',
      'link: /zh-cn/Blogs/',
      '---',
      '',
      '# 标题',
      '',
      '欢迎。第一段。<!-- 私密注记 -->',
      '',
      '![图片](/zh-cn/images/pic.png)',
      '',
      '\\[\nE=mc^2\n\\]',
      '',
      '```python',
      '# 代码注释',
      'print("中文")',
      '```',
      '',
      '```mermaid',
      'flowchart TD',
      '    A[小角度] --> B[运动方程]',
      '    B --> C[周期 T]',
      '```',
      '',
      '[博客](/zh-cn/Blogs/)',
      '',
      '<!-- private:start -->',
      '这段内容绝不能发送或写入。',
      '<!-- private:end -->',
      ''
    ].join('\n')
  })

  const { requestModel, prompts } = fakeModel()
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: await readFile(path.join(rootDir, 'docs/zh-cn/index.md'), 'utf8'),
    requestModel,
    md
  })

  assert.match(english, /# Title/)
  assert.match(english, /Welcome/)
  assert.match(english, /First paragraph\./)
  assert.match(english, /!\[图片\]\(\/images\/pic\.png\)/)
  assert.match(english, /```python\n# 代码注释\nprint\("中文"\)\n```/)
  assert.match(
    english,
    /```mermaid\nflowchart TD\n    A\[Small angle\] --> B\[Equation of motion\]\n    B --> C\[Period T\]\n```/
  )
  assert.match(english, /\[Blogs\]\(\/Blogs\/\)/)
  assert.match(english, /link: \/Blogs\//)
  assert.doesNotMatch(english, /私密注记|这段内容|private:start/)
  assert.doesNotMatch(prompts.map((entry) => entry.prompt).join('\n'), /私密注记|这段内容|private:start/)
})

test('translation prompts never receive protected code, formulas, or URLs', async (t) => {
  const sentinel = 'AI_TRANSLATE_SENTINEL_LOCAL_ONLY_2c9d'
  const source = [
    '# 标题',
    '',
    '中文段落 https://' + sentinel + '.example/inline-bare 继续。',
    '',
    '```js',
    `const fenced = '${sentinel}'`,
    '```',
    '',
    `    const indented = '${sentinel}'`,
    '',
    `行内 \`${sentinel}\` 值。`,
    '',
    `$${sentinel}$`,
    '',
    `[link](https://${sentinel}.example/target)`,
    '',
    `[https://${sentinel}.example/label](https://${sentinel}.example/link-target)`,
    '',
    `https://${sentinel}.example/path_(part)/suffix?token=${sentinel}`,
    '',
    `<a href="https://${sentinel}.example/html">中文</a>`,
    '',
    `<a href=/relative/path?token=${sentinel}>中文链接</a>`,
    '',
    '长段落 ' + 'a'.repeat(900) + ` \`多行代码 ${sentinel}`,
    `结束\` ${'b'.repeat(900)}。`,
    ''
  ].join('\n')
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
  const { requestModel, prompts } = fakeModel({
    bodyResponse: (text) => text
      .replaceAll('标题', 'Title')
      .replaceAll('中文段落', 'Visible paragraph.')
      .replaceAll('继续。', 'continued.')
      .replaceAll('行内', 'Inline')
      .replaceAll('值。', 'value.')
      .replaceAll('中文链接', 'Chinese link')
      .replaceAll('长段落', 'Long paragraph')
      .replaceAll('中文', 'Visible text')
  })
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: source,
    requestModel,
    md
  })

  assert.match(english, /```js\nconst fenced = 'AI_TRANSLATE_SENTINEL_LOCAL_ONLY_2c9d'\n```/)
  assert.match(english, new RegExp(`    const indented = '${sentinel}'`))
  assert.match(english, new RegExp(`Inline \`${sentinel}\` value\\.`))
  assert.match(english, new RegExp(`\\$${sentinel}\\$`))
  assert.match(english, new RegExp(`\\(https://${sentinel}\\.example/target\\)`))
  assert.match(english, new RegExp(`https://${sentinel}\\.example/path_\\(part\\)/suffix\\?token=${sentinel}`))
  assert.match(english, new RegExp(`href="https://${sentinel}\\.example/html"`))
  assert.match(english, new RegExp(`href=/relative/path\\?token=${sentinel}`))
  assert.ok(english.includes(`\`多行代码 ${sentinel}\n结束\``))
  assert.ok(
    !prompts.map((entry) => entry.prompt).join('\n').includes(sentinel),
    'protected sentinel reached a translation model prompt'
  )
  assert.ok(prompts.some((entry) => entry.prompt.includes('[inline code]')))
  assert.ok(prompts.some((entry) => entry.prompt.includes('[url]')))
})

test('adjacent inline code and bold endings get readable English spacing', async (t) => {
  const source = [
    '# 标题',
    '',
    '**建议：**保留现有配置。',
    '',
    '运行`base`后继续。',
    '',
    '使用`base`完成。',
    ''
  ].join('\n')
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
  const replacements = new Map([
    ['标题', 'Title'],
    ['建议：', 'Recommendation:'],
    ['保留现有配置。', 'Keep the existing configuration.'],
    ['运行', 'Run'],
    ['后继续。', 'then continue.'],
    ['使用', 'Use'],
    ['完成。', 'complete.']
  ])
  const { requestModel, prompts } = fakeModel({
    bodyResponse: (text) => replacements.get(text) ?? text
  })
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: source,
    requestModel,
    md
  })

  assert.match(english, /\*\*Recommendation:\*\* Keep the existing configuration\./)
  assert.match(english, /Run `base` then continue\./)
  assert.match(english, /Use `base` complete\./)
  assert.doesNotMatch(english, /`base`(?:and|then|complete)/)
  assert.doesNotMatch(english, /\*\*Recommendation:\*\*Keep/)
  const promptText = prompts.map((entry) => entry.prompt).join('\n')
  assert.match(promptText, /\[inline code\]/)
  assert.doesNotMatch(promptText, /`base`/)
})

test('table cell inline code uses the enclosing row source range', async (t) => {
  const source = [
    '# 标题',
    '',
    '| 名称 | 代码 |',
    '| --- | --- |',
    '| 链接 | `代码` |',
    ''
  ].join('\n')
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': source
  })
  const { requestModel, prompts } = fakeModel()
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: source,
    requestModel,
    md
  })

  assert.match(english, /\|\s*Name\s*\|\s*Code\s*\|/)
  assert.match(english, /\|\s*Link\s*\|\s*`代码`\s*\|/)
  assert.doesNotMatch(prompts.map((entry) => entry.prompt).join('\n'), /`代码`/)
})

test('English prose spaces links and converts leftover Chinese punctuation', async (t) => {
  const source = [
    '# 标题',
    '',
    '请参阅[关于](/zh-cn/About/)页面，并检查`count`。',
    '',
    '| 名称 | 公式 |',
    '| --- | --- |',
    '| 值 | $x$。 |',
    '',
    '`代码。`',
    ''
  ].join('\n')
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': source
  })
  const replacements = new Map([
    ['标题', 'Title'],
    ['请参阅', 'Please refer to'],
    ['关于', 'About'],
    ['页面，并检查', 'page，and check'],
    ['名称', 'Name'],
    ['公式', 'Formula'],
    ['值', 'Value']
  ])
  const { requestModel } = fakeModel({
    bodyResponse: (text) => replacements.get(text) ?? text
  })
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: source,
    requestModel,
    md
  })

  assert.match(
    english,
    /Please refer to \[About\]\(\/About\/\) page, and check `count`\./
  )
  assert.match(english, /\|\s*Name\s*\|\s*Formula\s*\|/)
  assert.match(english, /\|\s*Value\s*\|\s*\$x\$\.\s*\|/)
  assert.match(english, /`代码。`/)
  assert.ok(english.includes('(/About/)'))
  assert.doesNotMatch(english.replace(/`[^`\n]*`/g, ''), /[。，；：？！]/)
})

test('long tables, links, and inline code are translated in bounded segments', async (t) => {
  const rows = Array.from({ length: 18 }, (_, index) =>
    `| [链接${index}](/zh-cn/A/${index}) | \`代码${index}\` | 中文说明 ${index} |`
  ).join('\n')
  const source = [
    '# 标题',
    '',
    '第一段包含 [链接](/zh-cn/Blogs/) 和 `行内代码`。',
    '',
    '| 名称 | 代码 | 说明 |',
    '| --- | --- | --- |',
    rows,
    '',
    '```python',
    '# 中文代码',
    'print(1)',
    '```',
    '',
    '结尾段落。',
    ''
  ].join('\n')
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': source
  })

  const { requestModel, prompts } = fakeModel({
    bodyResponse: (body) => {
      for (const [chinese, english] of dictionary) {
        body = body.replaceAll(chinese, english)
      }
      return body
    }
  })
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/index.md',
    sourceText: source,
    requestModel,
    md
  })

  const batchPrompts = prompts.filter((entry) => entry.prompt.includes('<<<TEXT FRAGMENTS'))
  assert.ok(batchPrompts.length > 0)
  assert.ok(batchPrompts.length <= 8, `used ${batchPrompts.length} batch requests`)
  for (const entry of batchPrompts) {
    assert.doesNotMatch(entry.prompt, /@@[A-Za-z0-9_]+@@/)
    assert.doesNotMatch(entry.prompt, /\(\/zh-cn\/A\//)
    assert.doesNotMatch(entry.prompt, /\(\/A\//)
    const match = entry.prompt.match(/<<<TEXT FRAGMENTS [^>]+>>>\n([\s\S]*?)\n<<<END/)
    const segments = JSON.parse(match[1])
    assert.ok(segments.length <= 8)
    let fragmentCount = 0
    let characters = 0
    for (const segment of segments) {
      fragmentCount += segment.fragments.length
      characters += segment.context.length
      characters += segment.fragments.reduce((total, fragment) => total + fragment.text.length, 0)
    }
    assert.ok(fragmentCount <= 64)
    assert.ok(characters <= 12000)
  }
  assert.match(english, /# Title/)
  assert.match(english, /\[Link17\]\(\/A\/17\)/)
  assert.match(english, /`代码17`/)
  assert.match(english, /Chinese notes\. 17/)
  assert.match(english, /```python\n# 中文代码\nprint\(1\)\n```/)
  assert.match(english, /\| Name \| Code \| Description \|/)
  assert.doesNotMatch(english, /@@/)
})

test('malformed batch responses fail closed without writing', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n'
  })
  const { requestModel } = fakeModel({
    batchRawResponse: (items) => JSON.stringify(items.slice(1))
  })
  const errors = []
  const code = await main(['--write'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 1)
  assert.match(errors.join('\n'), /片段翻译数量|片段 ID|片段翻译结果/)
  await assert.rejects(readFile(path.join(rootDir, 'docs/index.md'), 'utf8'), { code: 'ENOENT' })
  assert.equal(
    await readFile(path.join(rootDir, 'README.md'), 'utf8'),
    '# Manual English\n\nDo not overwrite.\n'
  )
})

test('a model that changes table structure fails before writing', async (t) => {
  const source = '| 标题 |\n| --- |\n| 欢迎 |\n'
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': source
  })
  const { requestModel } = fakeModel({
    bodyResponse: (body) => body === '标题' ? 'Title | extra' : body
  })
  const md = await parserFor(rootDir)
  await assert.rejects(
    translateSource({
      sourcePath: 'docs/zh-cn/index.md',
      targetPath: 'docs/index.md',
      sourceText: source,
      requestModel,
      md
    }),
    /结构校验失败/
  )
})

test('missing fragment responses and semantic mismatches fail without writing', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n文字 `代码` 结束。\n'
  })
  const md = await parserFor(rootDir)
  const missing = fakeModel({
    batchRawResponse: (items) => JSON.stringify(items.slice(1))
  })
  await assert.rejects(
    translateSource({
      sourcePath: 'docs/zh-cn/index.md',
      targetPath: 'docs/index.md',
      sourceText: '# 标题\n\n文字 `代码` 结束。\n',
      requestModel: missing.requestModel,
      md
    }),
    /片段翻译数量|片段 ID/
  )

  const semantic = fakeModel({
    verdict: { equivalent: false, issues: ['The Chinese page mentions a missing fact.'] }
  })
  await assert.rejects(
    translateSource({
      sourcePath: 'docs/zh-cn/index.md',
      targetPath: 'docs/index.md',
      sourceText: '# 标题\n\n欢迎。\n',
      requestModel: semantic.requestModel,
      md
    }),
    /语义校验失败.*missing fact/s
  )
})

test('main is a safe plan by default and writes only missing English files', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '---\ntitle: 标题\nlink: /zh-cn/Blogs/\n---\n\n# 标题\n\n欢迎。\n',
    'docs/zh-cn/Blogs/demo.md': '# 博客\n\n正文。\n',
    '网站问题排查与优化方案.md': '# 根文档\n'
  })
  const { requestModel, prompts } = fakeModel()
  const logs = []
  const errors = []
  const options = {
    rootDir,
    requestModel,
    log: (line) => logs.push(line),
    errorLog: (line) => errors.push(line)
  }

  assert.equal(await main([], options), 0)
  assert.equal(prompts.length, 0)
  assert.equal(await readFile(path.join(rootDir, 'README.md'), 'utf8'), '# Manual English\n\nDo not overwrite.\n')
  assert.equal(logs.join('\n').includes('未写入任何文件'), true)

  assert.equal(await main(['--write'], options), 0)
  assert.deepEqual(errors, [])
  assert.equal(await readFile(path.join(rootDir, 'README.md'), 'utf8'), '# Manual English\n\nDo not overwrite.\n')
  const docsIndex = await readFile(path.join(rootDir, 'docs/index.md'), 'utf8')
  assert.match(docsIndex, /# Title/)
  assert.match(docsIndex, /link: \/Blogs\//)
  assert.match(await readFile(path.join(rootDir, 'docs/Blogs/demo.md'), 'utf8'), /# Blogs/)
  assert.match(await readFile(path.join(rootDir, '网站问题排查与优化方案.en.md'), 'utf8'), /# Root document\./)
})

test('force is required to replace manual English and only works with write', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n'
  })
  const { requestModel } = fakeModel()
  const errors = []
  const options = {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  }

  assert.equal(await main(['--force'], options), 2)
  assert.match(errors.join('\n'), /--force 必须与 --write/)

  const original = await readFile(path.join(rootDir, 'README.md'), 'utf8')
  assert.equal(await main(['--write'], options), 0)
  assert.equal(await readFile(path.join(rootDir, 'README.md'), 'utf8'), original)

  assert.equal(await main(['--write', '--force'], options), 0)
  assert.match(await readFile(path.join(rootDir, 'README.md'), 'utf8'), /# 中文说明|# Chinese notes/)
})

test('a failure in any file prevents every generated write', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/a.md': '# 标题\n\n欢迎。\n',
    'docs/zh-cn/b.md': '# 博客\n\n正文。\n'
  })
  const { requestModel, prompts } = fakeModel({
    bodyResponse: (body) => {
      if (body.includes('正文')) throw new Error('simulated model failure')
      return body.replaceAll('标题', 'Title').replaceAll('欢迎', 'Welcome')
    }
  })
  const errors = []
  const code = await main(['--write'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 1)
  assert.ok(prompts.length >= 1)
  assert.match(errors.join('\n'), /simulated model failure/)
  assert.match(errors.join('\n'), /未写入任何文件/)
  await assert.rejects(readFile(path.join(rootDir, 'docs/a.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/b.md'), 'utf8'), { code: 'ENOENT' })
})

test('the CLI can target an isolated root and a single pair for real-model E2E', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n',
    'docs/zh-cn/other.md': '# 博客\n\n正文。\n'
  })
  const { requestModel, prompts } = fakeModel()
  const errors = []
  const code = await main(
    ['--root', rootDir, '--only', 'docs/zh-cn/index.md', '--write'],
    {
      requestModel,
      log: () => {},
      errorLog: (line) => errors.push(line)
    }
  )
  assert.equal(code, 0)
  assert.deepEqual(errors, [])
  assert.match(await readFile(path.join(rootDir, 'docs/index.md'), 'utf8'), /# Title/)
  await assert.rejects(readFile(path.join(rootDir, 'docs/other.md'), 'utf8'), { code: 'ENOENT' })
  assert.equal(prompts.length > 0, true)
})

test('semantic failure leaves an existing manual English file untouched', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n'
  })
  const { requestModel } = fakeModel({
    verdict: { equivalent: false, issues: ['content changed'] }
  })
  const errors = []
  const code = await main(['--write', '--force', '--only', 'docs/zh-cn/index.md'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })
  assert.equal(code, 1)
  assert.match(errors.join('\n'), /语义校验失败/)
  assert.equal(await readFile(path.join(rootDir, 'README.md'), 'utf8'), '# Manual English\n\nDo not overwrite.\n')
})

test('atomic writes roll back an earlier commit when a later rename fails', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/one.md': 'old one\n',
    'docs/two.md': 'old two\n'
  })
  const files = {
    one: path.join(rootDir, 'docs/one.md'),
    two: path.join(rootDir, 'docs/two.md')
  }
  let renameCount = 0
  const fs = {
    rename: async (from, to) => {
      renameCount += 1
      if (renameCount === 2) throw new Error('simulated rename failure')
      const { rename } = await import('node:fs/promises')
      return rename(from, to)
    }
  }

  await assert.rejects(
    writeTranslationsAtomically({
      rootDir,
      fs,
      writes: [
        { targetPath: 'docs/one.md', targetFsPath: files.one, content: 'new one\n', original: { exists: true, content: 'old one\n', mode: 0o644 } },
        { targetPath: 'docs/two.md', targetFsPath: files.two, content: 'new two\n', original: { exists: true, content: 'old two\n', mode: 0o644 } }
      ]
    }),
    /已回滚/
  )
  assert.equal(await readFile(files.one, 'utf8'), 'old one\n')
  assert.equal(await readFile(files.two, 'utf8'), 'old two\n')
  const leftovers = (await readdir(path.join(rootDir, 'docs'))).filter((name) => name.startsWith('.omp-translate-'))
  assert.deepEqual(leftovers, [])
})

test('concurrent manual edits abort the batch instead of overwriting them', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/one.md': 'old one\n'
  })
  const target = path.join(rootDir, 'docs/one.md')
  const write = {
    targetPath: 'docs/one.md',
    targetFsPath: target,
    content: 'generated\n',
    original: { exists: true, content: 'old one\n', mode: 0o644 }
  }
  await writeFile(target, 'manual edit during generation\n', 'utf8')
  await assert.rejects(
    writeTranslationsAtomically({ rootDir, writes: [write] }),
    /在生成期间被修改/
  )
  assert.equal(await readFile(target, 'utf8'), 'manual edit during generation\n')
})

test('rollback never overwrites a concurrent edit', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/one.md': 'old one\n',
    'docs/two.md': 'old two\n'
  })
  const one = path.join(rootDir, 'docs/one.md')
  const two = path.join(rootDir, 'docs/two.md')
  let renames = 0
  const fs = {
    rename: async (from, to) => {
      renames += 1
      if (renames === 2) throw new Error('simulated second commit failure')
      const { rename } = await import('node:fs/promises')
      const result = await rename(from, to)
      if (renames === 1) await writeFile(one, 'user edit after commit\n', 'utf8')
      return result
    }
  }

  await assert.rejects(
    writeTranslationsAtomically({
      rootDir,
      fs,
      writes: [
        { targetPath: 'docs/one.md', targetFsPath: one, content: 'new one\n', original: { exists: true, content: 'old one\n', mode: 0o644 } },
        { targetPath: 'docs/two.md', targetFsPath: two, content: 'new two\n', original: { exists: true, content: 'old two\n', mode: 0o644 } }
      ]
    }),
    /回滚未完全成功|并发修改|拒绝回滚/
  )
  assert.equal(await readFile(one, 'utf8'), 'user edit after commit\n')
  assert.equal(await readFile(two, 'utf8'), 'old two\n')
})

test('new targets are created exclusively, never replacing a racing file', async (t) => {
  const rootDir = await makeProject(t, {})
  const target = path.join(rootDir, 'docs/new.md')
  await mkdir(path.dirname(target), { recursive: true })
  const fs = {
    link: async (from, to) => {
      await writeFile(to, 'racing user file\n', 'utf8')
      const error = new Error('EEXIST')
      error.code = 'EEXIST'
      throw error
    }
  }

  await assert.rejects(
    writeTranslationsAtomically({
      rootDir,
      fs,
      writes: [{
        targetPath: 'docs/new.md',
        targetFsPath: target,
        content: 'generated\n',
        original: { exists: false, content: null, mode: 0o666 }
      }]
    }),
    /提交瞬间被创建/
  )
  assert.equal(await readFile(target, 'utf8'), 'racing user file\n')
  const leftovers = (await readdir(path.dirname(target))).filter((name) => name.startsWith('.omp-translate-'))
  assert.deepEqual(leftovers, [])
})
