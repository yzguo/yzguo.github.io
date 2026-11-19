import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getMarkdownParser, maskMarkdown } from './markdown-safety.mjs'
import { parseFrontmatterScalars } from './document-model.mjs'
import { findSimplifiedText } from './traditional-chinese.mjs'
import {
  collectTranslationSources,
  main,
  segmentMarkdown,
  translateFrontmatter,
  translateSource,
  translateTraditionalSource,
  writeTranslationsAtomically
} from './translate-docs.mjs'

const dictionary = new Map([
  ['标题', 'Title'],
  ['副标题', 'Subtitle'],
  ['欢迎', 'Welcome'],
  ['第一段', 'First paragraph.'],
  ['第二段', 'Second paragraph.'],
  ['笔记', 'Notes'],
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
    if (prompt.includes('You are a strict trilingual documentation reviewer')) {
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
    'docs/zh-cn/Notes/demo.md': '# 笔记\n\n正文。\n',
    'docs/en/index.md': '# Existing English\n',
    'English.md': '# English page\n\n提到了中文专名。\n',
    '网站问题排查与优化方案.md': '# 根文档\n'
  })

  const collection = await collectTranslationSources(rootDir)
  assert.deepEqual(collection.errors, [])
  assert.deepEqual(
    collection.sources.map((source) => [
      source.sourcePath,
      source.targets.map((target) => target.targetPath)
    ]),
    [
      ['README.zh-CN.md', ['README.md', 'README.zh-TW.md']],
      ['docs/zh-cn/Notes/demo.md', ['docs/en/Notes/demo.md', 'docs/zh-tw/Notes/demo.md']],
      ['docs/zh-cn/index.md', ['docs/en/index.md', 'docs/zh-tw/index.md']],
      [
        '网站问题排查与优化方案.md',
        ['网站问题排查与优化方案.en.md', '网站问题排查与优化方案.zh-TW.md']
      ]
    ]
  )
})

test('generated English preserves code, math, links, and never includes private notes', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': [
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
      '[笔记](/zh-cn/Notes/)',
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
    targetPath: 'docs/en/index.md',
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
  assert.match(english, /\[Notes\]\(\/en\/Notes\/\)/)
  assert.match(english, /link: \/en\/Notes\//)
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
    `<a href=/zh-cn/relative/path?token=${sentinel}>中文链接</a>`,
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
    targetPath: 'docs/en/index.md',
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
  assert.match(english, new RegExp(`href=/en/relative/path\\?token=${sentinel}`))
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
    targetPath: 'docs/en/index.md',
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
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
  const { requestModel, prompts } = fakeModel()
  const md = await parserFor(rootDir)
  const english = await translateSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/en/index.md',
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
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
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
    targetPath: 'docs/en/index.md',
    sourceText: source,
    requestModel,
    md
  })

  assert.match(
    english,
    /Please refer to \[About\]\(\/en\/About\/\) page, and check `count`\./
  )
  assert.match(english, /\|\s*Name\s*\|\s*Formula\s*\|/)
  assert.match(english, /\|\s*Value\s*\|\s*\$x\$\.\s*\|/)
  assert.match(english, /`代码。`/)
  assert.ok(english.includes('(/en/About/)'))
  assert.doesNotMatch(english.replace(/`[^`\n]*`/g, ''), /[。，；：？！]/)
})

test('long tables, links, and inline code are translated in bounded segments', async (t) => {
  const rows = Array.from({ length: 18 }, (_, index) =>
    `| [链接${index}](/zh-cn/A/${index}) | \`代码${index}\` | 中文说明 ${index} |`
  ).join('\n')
  const source = [
    '# 标题',
    '',
    '第一段包含 [链接](/zh-cn/Notes/) 和 `行内代码`。',
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
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })

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
    targetPath: 'docs/en/index.md',
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
    assert.doesNotMatch(entry.prompt, /\(\/en\/A\//)
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
  assert.match(english, /\[Link17\]\(\/en\/A\/17\)/)
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
  const code = await main(['--write', '--lang', 'en'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 1)
  assert.match(errors.join('\n'), /片段翻译数量|片段 ID|片段翻译结果/)
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8'), { code: 'ENOENT' })
  assert.equal(
    await readFile(path.join(rootDir, 'README.md'), 'utf8'),
    '# Manual English\n\nDo not overwrite.\n'
  )
})

test('a model that changes table structure fails before writing', async (t) => {
  const source = '| 标题 |\n| --- |\n| 欢迎 |\n'
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
  const { requestModel } = fakeModel({
    bodyResponse: (body) => body === '标题' ? 'Title | extra' : body
  })
  const md = await parserFor(rootDir)
  await assert.rejects(
    translateSource({
      sourcePath: 'docs/zh-cn/index.md',
      targetPath: 'docs/en/index.md',
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
      targetPath: 'docs/en/index.md',
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
      targetPath: 'docs/en/index.md',
      sourceText: '# 标题\n\n欢迎。\n',
      requestModel: semantic.requestModel,
      md
    }),
    /语义校验失败.*missing fact/s
  )
})

test('Traditional translation is real conversion and preserves protected content', async (t) => {
  const source = [
    '---',
    'title: 标题',
    'link: /zh-cn/Notes/',
    '---',
    '',
    '# 标题',
    '',
    '这里介绍软件与网络。<!-- 私密注记 -->',
    '',
    '![图片](/zh-cn/images/pic.png)',
    '',
    '公式 $E=mc^2$。',
    '',
    '```python',
    '# 代码注释保持不变',
    'print("简体")',
    '```',
    '',
    '```mermaid',
    'flowchart TD',
    '    A[小角度] --> B[运动方程]',
    '```',
    '',
    '[笔记](/zh-cn/Notes/)',
    ''
  ].join('\n')
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': source })
  const md = await parserFor(rootDir)
  const traditional = await translateTraditionalSource({
    sourcePath: 'docs/zh-cn/index.md',
    targetPath: 'docs/zh-tw/index.md',
    sourceText: source,
    md
  })

  assert.notEqual(traditional, source)
  assert.match(traditional, /title: 標題/)
  assert.match(traditional, /link: \/zh-tw\/Notes\//)
  assert.match(traditional, /# 標題/)
  assert.match(traditional, /這裡介紹軟體與網路。/)
  assert.ok(traditional.includes('![圖片](/images/pic.png)'))
  assert.ok(traditional.includes('$E=mc^2$'))
  assert.ok(traditional.includes('```python\n# 代码注释保持不变\nprint("简体")\n```'))
  assert.ok(traditional.includes('A[小角度] --> B[運動方程]'))
  assert.ok(traditional.includes('[筆記](/zh-tw/Notes/)'))
  assert.doesNotMatch(traditional, /私密注记/)
})

test('main is a safe plan by default and writes missing English and Traditional targets', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '---\ntitle: 标题\nlink: /zh-cn/Notes/\n---\n\n# 标题\n\n欢迎。\n',
    'docs/zh-cn/Notes/demo.md': '# 笔记\n\n正文。\n',
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
  const docsIndex = await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8')
  assert.match(docsIndex, /# Title/)
  assert.match(docsIndex, /link: \/en\/Notes\//)
  const docsTraditional = await readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8')
  assert.match(docsTraditional, /# 標題/)
  assert.match(docsTraditional, /link: \/zh-tw\/Notes\//)
  assert.notEqual(docsTraditional, await readFile(path.join(rootDir, 'docs/zh-cn/index.md'), 'utf8'))
  assert.match(await readFile(path.join(rootDir, 'docs/en/Notes/demo.md'), 'utf8'), /# Notes/)
  assert.match(await readFile(path.join(rootDir, 'docs/zh-tw/Notes/demo.md'), 'utf8'), /# 筆記/)
  assert.match(await readFile(path.join(rootDir, '网站问题排查与优化方案.en.md'), 'utf8'), /# Root document\./)
  const rootTraditional = await readFile(
    path.join(rootDir, '网站问题排查与优化方案.zh-TW.md'),
    'utf8'
  )
  assert.match(rootTraditional, /^# 根/m)
  assert.equal(findSimplifiedText(rootTraditional), null)
  assert.notEqual(
    rootTraditional,
    await readFile(path.join(rootDir, '网站问题排查与优化方案.md'), 'utf8')
  )
  assert.match(await readFile(path.join(rootDir, 'README.zh-TW.md'), 'utf8'), /# 中文說明/)
})

test('force is required to replace manual targets and only works with write', async (t) => {
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
  assert.match(await readFile(path.join(rootDir, 'README.zh-TW.md'), 'utf8'), /# 中文說明/)
})

test('--lang limits generation and Traditional conversion needs no model', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n'
  })
  const { requestModel, prompts } = fakeModel()
  const errors = []
  const code = await main(['--write', '--lang', 'zh-tw', '--only', 'docs/zh-cn/index.md'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 0)
  assert.deepEqual(errors, [])
  assert.equal(prompts.length, 0, 'Traditional conversion must not call the model')
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), { code: 'ENOENT' })
  assert.match(await readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8'), /# 標題/)
})

test('a failure in any file prevents every generated write', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/a.md': '# 标题\n\n欢迎。\n',
    'docs/zh-cn/b.md': '# 笔记\n\n正文。\n'
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
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/a.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/b.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/zh-tw/a.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/zh-tw/b.md'), 'utf8'), { code: 'ENOENT' })
})

test('the CLI can target an isolated root and a single pair for real-model E2E', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n',
    'docs/zh-cn/other.md': '# 笔记\n\n正文。\n'
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
  assert.match(await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), /# Title/)
  assert.match(await readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8'), /# 標題/)
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/other.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/zh-tw/other.md'), 'utf8'), { code: 'ENOENT' })
  assert.equal(prompts.length > 0, true)
})

test('semantic failure leaves existing manual targets untouched', async (t) => {
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
  await assert.rejects(readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8'), { code: 'ENOENT' })
})

test('atomic writes roll back an earlier commit when a later rename fails', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/en/one.md': 'old one\n',
    'docs/zh-tw/two.md': 'old two\n'
  })
  const files = {
    one: path.join(rootDir, 'docs/en/one.md'),
    two: path.join(rootDir, 'docs/zh-tw/two.md')
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
        { targetPath: 'docs/en/one.md', targetFsPath: files.one, content: 'new one\n', original: { exists: true, content: 'old one\n', mode: 0o644 } },
        { targetPath: 'docs/zh-tw/two.md', targetFsPath: files.two, content: 'new two\n', original: { exists: true, content: 'old two\n', mode: 0o644 } }
      ]
    }),
    /已回滚/
  )
  assert.equal(await readFile(files.one, 'utf8'), 'old one\n')
  assert.equal(await readFile(files.two, 'utf8'), 'old two\n')
  const leftovers = [
    ...(await readdir(path.join(rootDir, 'docs/en'))),
    ...(await readdir(path.join(rootDir, 'docs/zh-tw')))
  ].filter((name) => name.startsWith('.omp-translate-'))
  assert.deepEqual(leftovers, [])
})

test('concurrent manual edits abort the batch instead of overwriting them', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-tw/one.md': 'old one\n'
  })
  const target = path.join(rootDir, 'docs/zh-tw/one.md')
  const write = {
    targetPath: 'docs/zh-tw/one.md',
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
    'docs/en/one.md': 'old one\n',
    'docs/zh-tw/two.md': 'old two\n'
  })
  const one = path.join(rootDir, 'docs/en/one.md')
  const two = path.join(rootDir, 'docs/zh-tw/two.md')
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
        { targetPath: 'docs/en/one.md', targetFsPath: one, content: 'new one\n', original: { exists: true, content: 'old one\n', mode: 0o644 } },
        { targetPath: 'docs/zh-tw/two.md', targetFsPath: two, content: 'new two\n', original: { exists: true, content: 'old two\n', mode: 0o644 } }
      ]
    }),
    /回滚未完全成功|并发修改|拒绝回滚/
  )
  assert.equal(await readFile(one, 'utf8'), 'user edit after commit\n')
  assert.equal(await readFile(two, 'utf8'), 'old two\n')
})

test('new targets are created exclusively, never replacing a racing file', async (t) => {
  const rootDir = await makeProject(t, {})
  const target = path.join(rootDir, 'docs/zh-tw/new.md')
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
        targetPath: 'docs/zh-tw/new.md',
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

// Frontmatter value translation shares the merged translation pipeline.

function frontmatter(lines) {
  return `${lines.join('\n')}\n`
}

test('frontmatter translation changes values but not keys, links, or structure', async () => {
  const source = frontmatter([
    'layout: home',
    'hero:',
    '  name: "郭彦禛"',
    '  text: 个人网站',
    '  tagline: \'碎碎念喵\'',
    '  image:',
    '    src: /images/pic.png',
    '    alt: 郭彦禛的头像',
    '  actions:',
    '    - theme: brand',
    '      text: 笔记',
    '      link: /zh-cn/Notes/',
    'features:',
    '  - title: 关于',
    '    details: 学习经历、兴趣与联系方式。',
    '    link: /zh-cn/About/',
    '    linkText: 了解我'
  ])

  const calls = []
  const requestModel = async ({ prompt }) => {
    calls.push(prompt)
    const values = JSON.parse(prompt.match(/<<<FRONTMATTER VALUES [^>]+>>>\n([\s\S]*?)\n<<<END/)[1])
    return JSON.stringify(values.map((value) => {
      if (value === '郭彦禛') return 'Yanzhen Guo'
      if (value === '个人网站') return 'Personal website'
      if (value === '碎碎念喵') return 'Ramblings, meow.'
      if (value === '郭彦禛的头像') return "Yanzhen Guo's profile photo"
      if (value === '笔记') return 'Notes'
      if (value === '关于') return 'About'
      if (value === '学习经历、兴趣与联系方式。') return 'Education, interests, and contact details.'
      if (value === '了解我') return 'About me'
      return 'Translated'
    }))
  }

  const translated = await translateFrontmatter(source, {
    requestModel,
    sourcePath: 'docs/zh-cn/index.md'
  })

  assert.equal(calls.length, 1)
  assert.match(translated, /layout: home/)
  assert.match(translated, /name: "Yanzhen Guo"/)
  assert.match(translated, /text: Personal website/)
  assert.match(translated, /tagline: 'Ramblings, meow\.'/)
  assert.match(translated, /src: \/images\/pic\.png/)
  assert.match(translated, /alt: Yanzhen Guo's profile photo/)
  assert.match(translated, /link: \/en\/Notes\//)
  assert.match(translated, /link: \/en\/About\//)
  assert.match(translated, /- title: About/)
  assert.doesNotMatch(translated, /郭彦禛|关于|了解我/)
})

test('frontmatter without Chinese text does not call the model but localizes links', async () => {
  const source = frontmatter([
    'hero:',
    '  image:',
    '    src: /images/pic.png',
    '  actions:',
    '    - text: English already',
    '      link: /zh-cn/Notes/'
  ])
  const requestModel = async () => {
    throw new Error('model must not be called')
  }
  const translated = await translateFrontmatter(source, { requestModel, sourcePath: 'x' })
  assert.match(translated, /text: English already/)
  assert.match(translated, /link: \/en\/Notes\//)
})

test('unsupported YAML constructs with Chinese fail instead of corrupting the file', async () => {
  const block = frontmatter(['description: |', '  第一行', '  第二行'])
  await assert.rejects(
    translateFrontmatter(block, { requestModel: async () => '[]', sourcePath: 'x' }),
    /块字符串含中文/
  )

  const flow = frontmatter(['tags: [中文, 英文]'])
  await assert.rejects(
    translateFrontmatter(flow, { requestModel: async () => '[]', sourcePath: 'x' }),
    /流式集合含中文/
  )

  const multiline = frontmatter(['title: "第一行', '  第二行"'])
  await assert.rejects(
    translateFrontmatter(multiline, { requestModel: async () => '[]', sourcePath: 'x' }),
    /双引号|YAML/
  )
})

test('malformed model output is rejected before any value is written', async () => {
  const source = frontmatter(['title: 标题', 'subtitle: 副标题'])
  await assert.rejects(
    translateFrontmatter(source, {
      requestModel: async () => JSON.stringify(['Only one']),
      sourcePath: 'x'
    }),
    /期望 2 条/
  )
  await assert.rejects(
    translateFrontmatter(source, {
      requestModel: async () => JSON.stringify(['One', 'Two', 'Three']),
      sourcePath: 'x'
    }),
    /期望 2 条/
  )
  await assert.rejects(
    translateFrontmatter(source, {
      requestModel: async () => 'not json',
      sourcePath: 'x'
    }),
    /不是有效 JSON/
  )
  await assert.rejects(
    translateFrontmatter(source, {
      requestModel: async () => JSON.stringify(['Line\nbreak', 'Two']),
      sourcePath: 'x'
    }),
    /包含换行/
  )
  await assert.rejects(
    translateFrontmatter(source, {
      requestModel: async () => JSON.stringify(['<!-- hidden -->', 'Two']),
      sourcePath: 'x'
    }),
    /私有内容标记/
  )
})

test('Chinese paths in frontmatter are rejected instead of corrupted', async () => {
  await assert.rejects(
    translateFrontmatter(frontmatter(['link: /zh-cn/中文页面/']), {
      requestModel: async () => JSON.stringify(['/Chinese page/']),
      sourcePath: 'x'
    }),
    /路径或 URL 含中文/
  )
})

test('scalar parser exposes only translatable values and records line numbers', () => {
  const parsed = parseFrontmatterScalars(frontmatter([
    'title: 标题',
    'items:',
    '  - 第一项',
    '  - theme: brand',
    '    text: 第二项'
  ]))
  assert.deepEqual(
    parsed.records.filter((record) => !record.error).map((record) => [record.line + 1, record.value]),
    [[1, '标题'], [3, '第一项'], [4, 'brand'], [5, '第二项']]
  )
})

// Markdown segmentation shares the merged translation pipeline.

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

test('a source hardlinked to the private config aborts with zero model calls and no writes', async (t) => {
  const rootDir = await makeProject(t, {})
  const secret = 'TRANSLATION_FAKE_CONFIG_SENTINEL_5c1d'
  const configPath = path.join(rootDir, 'tools', 'config.yaml')
  const sourcePath = path.join(rootDir, 'docs', 'zh-cn', 'index.md')
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, secret, 'utf8')
  await link(configPath, sourcePath)

  const { requestModel: underlying } = fakeModel()
  let modelCalls = 0
  const requestModel = async (request) => {
    modelCalls += 1
    return underlying(request)
  }
  const errors = []
  const code = await main(['--write', '--only', 'docs/zh-cn/index.md'], {
    rootDir,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 1)
  assert.equal(modelCalls, 0)
  await assert.rejects(
    readFile(path.join(rootDir, 'docs', 'en', 'index.md'), 'utf8'),
    { code: 'ENOENT' }
  )
  assert.match(errors.join('\n'), /无法安全读取 Markdown 源文件/)
  assert.ok(!errors.join('\n').includes(secret))
})

test('a parent-directory swap during a source read aborts with zero model calls and no writes', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n'
  })
  const sourcePath = path.join(rootDir, 'docs', 'zh-cn', 'index.md')
  const sourceParent = path.dirname(sourcePath)
  let modelCalls = 0
  const fs = {
    open: async (target, flags) => {
      const real = await import('node:fs/promises')
      const handle = await real.open(target, flags)
      return {
        stat: (...args) => handle.stat(...args),
        close: () => handle.close(),
        readFile: async (options) => {
          const content = await handle.readFile(options)
          await real.rename(sourceParent, `${sourceParent}-moved`)
          await real.mkdir(sourceParent, { recursive: true })
          await real.writeFile(sourcePath, '# 替换\n\n替换。\n', 'utf8')
          return content
        }
      }
    }
  }
  const { requestModel: underlying } = fakeModel()
  const requestModel = async (request) => {
    modelCalls += 1
    return underlying(request)
  }
  const errors = []
  const code = await main(['--write', '--only', 'docs/zh-cn/index.md'], {
    rootDir,
    fs,
    requestModel,
    log: () => {},
    errorLog: (line) => errors.push(line)
  })

  assert.equal(code, 1)
  assert.equal(modelCalls, 0)
  await assert.rejects(
    readFile(path.join(rootDir, 'docs', 'en', 'index.md'), 'utf8'),
    { code: 'ENOENT' }
  )
  assert.match(errors.join('\n'), /无法安全读取 Markdown 源文件/)
})
