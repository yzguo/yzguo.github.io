import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename as renameFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { main } from './content-sync.mjs'
import { findSimplifiedText } from './traditional-chinese.mjs'

const phrases = [
  ['本目录包含以下页面', 'This directory contains the following pages', '本目錄包含以下頁面AI'],
  ['第二段新增', 'Second added paragraph.', '第二段新增AI'],
  ['第二篇', 'Second page', '第二篇AI'],
  ['课程笔记', 'Course notes', '課程筆記AI'],
  ['运动方程', 'Equation of motion', '運動方程AI'],
  ['副标题', 'Subtitle', '副標題AI'],
  ['第一段', 'First paragraph.', '第一段AI'],
  ['第二段', 'Second paragraph.', '第二段AI'],
  ['小角度', 'Small angle', '小角度AI'],
  ['新增内容', 'New content.', '新增內容AI'],
  ['标题', 'Title', '標題AI'],
  ['欢迎', 'Welcome', '歡迎'],
  ['演示', 'Demo', '演示AI'],
  ['笔记', 'Notes', '筆記AI'],
  ['链接', 'Link', '連結AI'],
  ['正文', 'Body', '正文'],
  ['信息', 'Information', '資訊AI'],
  ['说明', 'Description', '說明AI']
].sort((left, right) => right[0].length - left[0].length)

function translateValue(value, target) {
  let translated = String(value)
  for (const [chinese, english, traditional] of phrases) {
    translated = translated.replaceAll(chinese, target === 'zh-tw' ? traditional : english)
  }
  return translated
}

function detectTarget(prompt) {
  return prompt.includes('Traditional Chinese') ? 'zh-tw' : 'en'
}

function extractBlock(prompt, name) {
  const pattern = new RegExp(`<<<${name} [^>]+>>>\\n([\\s\\S]*?)\\n<<<END ${name} [^>]+>>>`)
  const match = prompt.match(pattern)
  if (!match) throw new Error(`missing ${name} block`)
  return JSON.parse(match[1])
}

function fakeModel(options = {}) {
  const calls = []
  async function requestModel(request) {
    const prompt = String(request?.prompt ?? '')
    const system = String(request?.system ?? '')
    if (prompt.includes('You are a strict trilingual documentation reviewer')) {
      const call = { kind: 'semantic', target: detectTarget(prompt), system, prompt }
      calls.push(call)
      if (options.semanticError) throw new Error(options.semanticError)
      if (options.semanticVerdict) return JSON.stringify(options.semanticVerdict)
      return JSON.stringify({ equivalent: true, issues: [] })
    }

    if (prompt.includes('<<<TEXT FRAGMENTS')) {
      const target = detectTarget(prompt)
      const call = { kind: 'body', target, system, prompt }
      calls.push(call)
      if (options.failKind === 'body' && options.failTarget === target) {
        throw new Error(`simulated ${target} body failure`)
      }
      if (options.onBody) await options.onBody({ target, prompt })
      const segments = extractBlock(prompt, 'TEXT FRAGMENTS')
      const translated = []
      for (const segment of segments) {
        for (const fragment of segment.fragments) {
          translated.push({
            id: fragment.id,
            text: translateValue(fragment.text, target)
          })
        }
      }
      return JSON.stringify(translated)
    }

    if (prompt.includes('<<<FRONTMATTER VALUES')) {
      const target = detectTarget(prompt)
      calls.push({ kind: 'frontmatter', target, system, prompt })
      const values = extractBlock(prompt, 'FRONTMATTER VALUES')
      return JSON.stringify(values.map((value) => translateValue(value, target)))
    }

    if (prompt.includes('<<<MERMAID LABELS')) {
      const target = detectTarget(prompt)
      calls.push({ kind: 'mermaid', target, system, prompt })
      const values = extractBlock(prompt, 'MERMAID LABELS')
      return JSON.stringify(values.map((value) => translateValue(value, target)))
    }

    throw new Error(`unexpected prompt: ${prompt.slice(0, 120)}`)
  }
  return { requestModel, calls }
}

async function makeProject(t, files = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'omp-content-sync-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(rootDir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await mkdir(path.join(rootDir, 'docs', 'zh-cn'), { recursive: true })
  return rootDir
}

async function readManifest(rootDir) {
  return JSON.parse(
    await readFile(path.join(rootDir, 'tools', 'content-sync-state.json'), 'utf8')
  )
}

async function exists(rootDir, relative) {
  try {
    await readFile(path.join(rootDir, relative), 'utf8')
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function run(rootDir, fake, argv = [], extra = {}) {
  const logs = []
  const errors = []
  const code = await main(argv, {
    rootDir,
    requestModel: fake.requestModel,
    log: (message) => logs.push(String(message)),
    errorLog: (message) => errors.push(String(message)),
    ...extra
  })
  return { code, logs, errors, output: logs.join('\n'), errorOutput: errors.join('\n') }
}

const indexSource = `---
title: "标题"
description: "说明"
---

# 标题

第一段包含 \`count\`、公式 $x$ 和[链接](/zh-cn/Notes/)。

\`\`\`mermaid
flowchart TD
    A[小角度] --> B[运动方程]
\`\`\`

欢迎。

<!-- private: SENTINEL_PRIVATE_VALUE -->
`

test('new sources generate English and Traditional pages with the configured model', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': indexSource
  })
  const fake = fakeModel()
  const result = await run(rootDir, fake)

  assert.equal(result.code, 0, result.errorOutput)
  const english = await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8')
  const traditional = await readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8')
  assert.match(english, /title: "Title"/)
  assert.match(english, /# Title/)
  assert.match(english, /First paragraph\./)
  assert.ok(english.includes('`count`'))
  assert.ok(english.includes('$x$'))
  assert.ok(english.includes('(/en/Notes/)'))
  assert.ok(english.includes('Small angle'))
  assert.doesNotMatch(english, /SENTINEL_PRIVATE_VALUE/)

  assert.match(traditional, /title: "標題AI"/)
  assert.match(traditional, /# 標題AI/)
  assert.match(traditional, /第一段AI/)
  assert.ok(traditional.includes('(/zh-tw/Notes/)'))
  assert.ok(traditional.includes('小角度AI'))
  assert.equal(findSimplifiedText(traditional), null)
  assert.doesNotMatch(traditional, /SENTINEL_PRIVATE_VALUE/)

  const bodyCalls = fake.calls.filter((call) => call.kind === 'body')
  assert.ok(bodyCalls.some((call) => call.target === 'en'))
  assert.ok(bodyCalls.some((call) => call.target === 'zh-tw'))
  assert.ok(fake.calls.some((call) => call.kind === 'frontmatter' && call.target === 'zh-tw'))
  assert.ok(fake.calls.some((call) => call.kind === 'mermaid' && call.target === 'zh-tw'))
  for (const call of fake.calls) assert.doesNotMatch(call.prompt, /SENTINEL_PRIVATE_VALUE/)

  const manifest = await readManifest(rootDir)
  const entry = manifest.pages['docs/zh-cn/index.md']
  assert.equal(entry.autoIndex, undefined)
  assert.match(entry.sourceHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(entry.targets.en.path, 'docs/en/index.md')
  assert.equal(entry.targets['zh-tw'].path, 'docs/zh-tw/index.md')
  assert.equal(entry.targets.en.sourceHash, entry.sourceHash)
  assert.equal(entry.targets['zh-tw'].sourceHash, entry.sourceHash)
  assert.doesNotMatch(
    await readFile(path.join(rootDir, 'tools', 'content-sync-state.json'), 'utf8'),
    /SENTINEL_PRIVATE_VALUE/
  )
})

test('a second run with no changes makes no model calls and writes nothing', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': '# 标题\n\n欢迎。\n' })
  const first = fakeModel()
  assert.equal((await run(rootDir, first)).code, 0)
  const before = await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8')
  const manifestBefore = await readFile(
    path.join(rootDir, 'tools', 'content-sync-state.json'),
    'utf8'
  )

  const second = fakeModel()
  const result = await run(rootDir, second)
  assert.equal(result.code, 0, result.errorOutput)
  assert.equal(second.calls.length, 0)
  assert.match(result.output, /未调用模型/)
  assert.equal(await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), before)
  assert.equal(
    await readFile(path.join(rootDir, 'tools', 'content-sync-state.json'), 'utf8'),
    manifestBefore
  )
})

test('modifying a source updates both trusted generated targets', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': '# 标题\n\n第一段。\n' })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const manifestBefore = await readManifest(rootDir)

  await writeFile(
    path.join(rootDir, 'docs/zh-cn/index.md'),
    '# 标题\n\n第二段新增。\n',
    'utf8'
  )
  const fake = fakeModel()
  const result = await run(rootDir, fake)
  assert.equal(result.code, 0, result.errorOutput)
  assert.ok(fake.calls.some((call) => call.kind === 'body' && call.target === 'en'))
  assert.ok(fake.calls.some((call) => call.kind === 'body' && call.target === 'zh-tw'))

  const english = await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8')
  const traditional = await readFile(path.join(rootDir, 'docs/zh-tw/index.md'), 'utf8')
  assert.match(english, /Second added paragraph\./)
  assert.match(traditional, /第二段[^\n]*新增/)
  assert.doesNotMatch(traditional, /第一段AI/)

  const manifestAfter = await readManifest(rootDir)
  const entry = manifestAfter.pages['docs/zh-cn/index.md']
  assert.notEqual(entry.sourceHash, manifestBefore.pages['docs/zh-cn/index.md'].sourceHash)
  assert.equal(entry.targets.en.sourceHash, entry.sourceHash)
  assert.equal(entry.targets['zh-tw'].sourceHash, entry.sourceHash)
})

test('a manually edited target is refused without overwriting anything', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/index.md': '# 标题\n\n第一段。\n' })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const englishPath = path.join(rootDir, 'docs/en/index.md')
  const traditionalPath = path.join(rootDir, 'docs/zh-tw/index.md')
  const manifestPath = path.join(rootDir, 'tools', 'content-sync-state.json')
  await writeFile(englishPath, `${await readFile(englishPath, 'utf8')}\nmanual edit\n`, 'utf8')
  const englishBefore = await readFile(englishPath, 'utf8')
  const traditionalBefore = await readFile(traditionalPath, 'utf8')
  const manifestBefore = await readFile(manifestPath, 'utf8')

  const fake = fakeModel()
  const result = await run(rootDir, fake)
  assert.equal(result.code, 1)
  assert.equal(fake.calls.length, 0)
  assert.match(result.errorOutput, /人工编辑|哈希不一致/)
  assert.equal(await readFile(englishPath, 'utf8'), englishBefore)
  assert.equal(await readFile(traditionalPath, 'utf8'), traditionalBefore)
  assert.equal(await readFile(manifestPath, 'utf8'), manifestBefore)
})

test('an existing target without a trusted baseline is refused', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n第一段。\n',
    'docs/en/index.md': '# Manual English\n'
  })
  const fake = fakeModel()
  const result = await run(rootDir, fake)
  assert.equal(result.code, 1)
  assert.equal(fake.calls.length, 0)
  assert.match(result.errorOutput, /没有可信基线/)
  assert.equal(await readFile(path.join(rootDir, 'docs/en/index.md'), 'utf8'), '# Manual English\n')
  assert.equal(await exists(rootDir, 'docs/zh-tw/index.md'), false)
  assert.equal(await exists(rootDir, 'tools/content-sync-state.json'), false)
})

test('a failure after one target is generated prevents every write', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  const fake = fakeModel({ failKind: 'body', failTarget: 'zh-tw' })
  const result = await run(rootDir, fake)
  assert.equal(result.code, 1)
  assert.match(result.errorOutput, /生成失败/)
  assert.match(result.errorOutput, /未写入任何文件/)
  assert.equal(await exists(rootDir, 'docs/en/page.md'), false)
  assert.equal(await exists(rootDir, 'docs/zh-tw/page.md'), false)
  assert.equal(await exists(rootDir, 'tools/content-sync-state.json'), false)
})

test('a source modified during generation aborts before committing targets or manifest', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const sourcePath = path.join(rootDir, 'docs/zh-cn/page.md')
  const englishPath = path.join(rootDir, 'docs/en/page.md')
  const traditionalPath = path.join(rootDir, 'docs/zh-tw/page.md')
  const manifestPath = path.join(rootDir, 'tools', 'content-sync-state.json')
  const englishBefore = await readFile(englishPath, 'utf8')
  const traditionalBefore = await readFile(traditionalPath, 'utf8')
  const manifestBefore = await readFile(manifestPath, 'utf8')

  await writeFile(sourcePath, '# 标题\n\n第二段新增。\n', 'utf8')
  let modified = false
  const fake = fakeModel({
    onBody: async () => {
      if (modified) return
      modified = true
      await writeFile(sourcePath, '# 标题\n\n并发修改。\n', 'utf8')
    }
  })
  const result = await run(rootDir, fake)
  assert.equal(result.code, 1)
  assert.match(result.errorOutput, /简体源.*(修改|替换|变化)/)
  assert.equal(await readFile(englishPath, 'utf8'), englishBefore)
  assert.equal(await readFile(traditionalPath, 'utf8'), traditionalBefore)
  assert.equal(await readFile(manifestPath, 'utf8'), manifestBefore)
})

test('a semantic review failure prevents writes and names the failure', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  const fake = fakeModel({
    semanticVerdict: { equivalent: false, issues: ['missing paragraph'] }
  })
  const result = await run(rootDir, fake)
  assert.equal(result.code, 1)
  assert.match(result.errorOutput, /语义校验失败/)
  assert.match(result.errorOutput, /missing paragraph/)
  assert.equal(await exists(rootDir, 'docs/en/page.md'), false)
  assert.equal(await exists(rootDir, 'docs/zh-tw/page.md'), false)
  assert.equal(await exists(rootDir, 'tools/content-sync-state.json'), false)
})

test('baseline initialization trusts existing complete trilingual pages without calling the model', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/index.md': '# 标题\n\n第一段。\n',
    'docs/en/index.md': '# Title\n\nFirst paragraph.\n',
    'docs/zh-tw/index.md': '# 標題\n\n第一段。\n'
  })
  const fake = fakeModel()
  const result = await run(rootDir, fake, ['--init'])
  assert.equal(result.code, 0, result.errorOutput)
  assert.equal(fake.calls.length, 0)
  const manifest = await readManifest(rootDir)
  const entry = manifest.pages['docs/zh-cn/index.md']
  assert.ok(entry)
  assert.equal(entry.targets.en.path, 'docs/en/index.md')
  assert.equal(entry.targets['zh-tw'].path, 'docs/zh-tw/index.md')
  assert.equal(entry.targets.en.sourceHash, entry.sourceHash)

  const second = fakeModel()
  const noChange = await run(rootDir, second)
  assert.equal(noChange.code, 0, noChange.errorOutput)
  assert.equal(second.calls.length, 0)
})

test('a markdown-only new folder gets a minimal source index translated into both locales', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/NewFolder/demo.md': '# 演示\n\n正文。\n'
  })
  const result = await run(rootDir, fakeModel())
  assert.equal(result.code, 0, result.errorOutput)

  const sourceIndex = await readFile(
    path.join(rootDir, 'docs/zh-cn/NewFolder/index.md'),
    'utf8'
  )
  assert.equal(
    sourceIndex,
    '# NewFolder\n\n本目录包含以下页面：\n\n- [演示](/zh-cn/NewFolder/demo)\n'
  )
  const englishIndex = await readFile(
    path.join(rootDir, 'docs/en/NewFolder/index.md'),
    'utf8'
  )
  const traditionalIndex = await readFile(
    path.join(rootDir, 'docs/zh-tw/NewFolder/index.md'),
    'utf8'
  )
  assert.match(englishIndex, /# NewFolder/)
  assert.match(englishIndex, /\/en\/NewFolder\/demo/)
  assert.match(traditionalIndex, /本目錄包含以下頁面AI/)
  assert.match(traditionalIndex, /\/zh-tw\/NewFolder\/demo/)
  assert.equal(findSimplifiedText(traditionalIndex), null)

  const manifest = await readManifest(rootDir)
  assert.equal(manifest.pages['docs/zh-cn/NewFolder/index.md'].autoIndex, true)
  assert.equal(
    manifest.pages['docs/zh-cn/NewFolder/index.md'].targets.en.path,
    'docs/en/NewFolder/index.md'
  )
})

test('a tool-generated index refreshes when its folder gains a page', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/NewFolder/demo.md': '# 演示\n\n正文。\n'
  })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  await writeFile(
    path.join(rootDir, 'docs/zh-cn/NewFolder/second.md'),
    '# 第二篇\n\n正文。\n',
    'utf8'
  )
  const result = await run(rootDir, fakeModel())
  assert.equal(result.code, 0, result.errorOutput)
  const sourceIndex = await readFile(
    path.join(rootDir, 'docs/zh-cn/NewFolder/index.md'),
    'utf8'
  )
  assert.equal(
    sourceIndex,
    '# NewFolder\n\n本目录包含以下页面：\n\n' +
    '- [演示](/zh-cn/NewFolder/demo)\n' +
    '- [第二篇](/zh-cn/NewFolder/second)\n'
  )
  assert.match(
    await readFile(path.join(rootDir, 'docs/en/NewFolder/index.md'), 'utf8'),
    /Second page/
  )
  const manifest = await readManifest(rootDir)
  assert.equal(manifest.pages['docs/zh-cn/NewFolder/index.md'].autoIndex, true)
})

test('an auto index edited by hand is not overwritten when the folder changes', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/NewFolder/demo.md': '# 演示\n\n正文。\n'
  })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const indexPath = path.join(rootDir, 'docs/zh-cn/NewFolder/index.md')
  const manual = '# 手写索引\n\n手写内容。\n'
  await writeFile(indexPath, manual, 'utf8')
  await writeFile(
    path.join(rootDir, 'docs/zh-cn/NewFolder/second.md'),
    '# 第二篇\n\n正文。\n',
    'utf8'
  )
  const result = await run(rootDir, fakeModel())
  assert.equal(result.code, 0, result.errorOutput)
  assert.equal(await readFile(indexPath, 'utf8'), manual)
  const manifest = await readManifest(rootDir)
  assert.equal(manifest.pages['docs/zh-cn/NewFolder/index.md'].autoIndex, undefined)
  const third = await run(rootDir, fakeModel())
  assert.equal(third.code, 0, third.errorOutput)
  assert.equal(await readFile(indexPath, 'utf8'), manual)
})

test('an auto index under Notes uses the shared NotesIndex data component', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/Notes/NewCategory/demo.md': '# 演示\n\n正文。\n'
  })
  const result = await run(rootDir, fakeModel())
  assert.equal(result.code, 0, result.errorOutput)
  const sourceIndex = await readFile(
    path.join(rootDir, 'docs/zh-cn/Notes/NewCategory/index.md'),
    'utf8'
  )
  assert.equal(sourceIndex, '# NewCategory\n\n<NotesIndex />\n')
  assert.match(
    await readFile(path.join(rootDir, 'docs/en/Notes/NewCategory/index.md'), 'utf8'),
    /<NotesIndex \/>/
  )
  assert.match(
    await readFile(path.join(rootDir, 'docs/zh-tw/Notes/NewCategory/index.md'), 'utf8'),
    /<NotesIndex \/>/
  )
})

test('an existing user index is never overwritten', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/Manual/index.md': '# 手写索引\n\n手写内容。\n',
    'docs/zh-cn/Manual/demo.md': '# 演示\n\n正文。\n'
  })
  const original = await readFile(path.join(rootDir, 'docs/zh-cn/Manual/index.md'), 'utf8')
  const result = await run(rootDir, fakeModel())
  assert.equal(result.code, 0, result.errorOutput)
  assert.equal(
    await readFile(path.join(rootDir, 'docs/zh-cn/Manual/index.md'), 'utf8'),
    original
  )
})

test('--lang generates only the requested locale and never marks the other locale synced', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  const firstFake = fakeModel()
  const first = await run(rootDir, firstFake, ['--lang', 'en'])
  assert.equal(first.code, 0, first.errorOutput)
  assert.equal(await exists(rootDir, 'docs/zh-tw/page.md'), false)
  const firstManifest = await readManifest(rootDir)
  assert.ok(firstManifest.pages['docs/zh-cn/page.md'].targets.en)
  assert.equal(firstManifest.pages['docs/zh-cn/page.md'].targets['zh-tw'], undefined)
  const englishBefore = await readFile(path.join(rootDir, 'docs/en/page.md'), 'utf8')
  const englishBodyCalls = firstFake.calls.filter(
    (call) => call.kind === 'body' && call.target === 'en'
  ).length

  const secondFake = fakeModel()
  const second = await run(rootDir, secondFake)
  assert.equal(second.code, 0, second.errorOutput)
  assert.equal(await exists(rootDir, 'docs/zh-tw/page.md'), true)
  assert.equal(await readFile(path.join(rootDir, 'docs/en/page.md'), 'utf8'), englishBefore)
  assert.equal(
    secondFake.calls.filter((call) => call.kind === 'body' && call.target === 'en').length,
    0
  )
  assert.equal(englishBodyCalls, 1)
  const manifest = await readManifest(rootDir)
  assert.equal(
    manifest.pages['docs/zh-cn/page.md'].targets['zh-tw'].sourceHash,
    manifest.pages['docs/zh-cn/page.md'].sourceHash
  )
})

test('--only still refuses a manually edited selected target', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const englishPath = path.join(rootDir, 'docs/en/page.md')
  await writeFile(englishPath, `${await readFile(englishPath, 'utf8')}\nmanual\n`, 'utf8')
  await writeFile(
    path.join(rootDir, 'docs/zh-cn/page.md'),
    '# 标题\n\n第二段新增。\n',
    'utf8'
  )
  const englishBefore = await readFile(englishPath, 'utf8')
  const fake = fakeModel()
  const result = await run(rootDir, fake, ['--only', 'docs/en/page.md'])
  assert.equal(result.code, 1)
  assert.equal(fake.calls.length, 0)
  assert.match(result.errorOutput, /人工编辑|哈希不一致/)
  assert.equal(await readFile(englishPath, 'utf8'), englishBefore)
})

test('a write failure on the manifest rolls back generated pages', async (t) => {
  const rootDir = await makeProject(t, { 'docs/zh-cn/page.md': '# 标题\n\n第一段。\n' })
  assert.equal((await run(rootDir, fakeModel())).code, 0)
  const englishBefore = await readFile(path.join(rootDir, 'docs/en/page.md'), 'utf8')
  const traditionalBefore = await readFile(path.join(rootDir, 'docs/zh-tw/page.md'), 'utf8')
  const manifestBefore = await readFile(
    path.join(rootDir, 'tools', 'content-sync-state.json'),
    'utf8'
  )
  await writeFile(
    path.join(rootDir, 'docs/zh-cn/page.md'),
    '# 标题\n\n第二段新增。\n',
    'utf8'
  )

  const fake = fakeModel()
  const failingFs = {
    rename: async (from, to) => {
      if (path.basename(to) === 'content-sync-state.json') {
        throw new Error('simulated manifest rename failure')
      }
      return renameFile(from, to)
    }
  }
  const result = await run(rootDir, fake, [], { fs: failingFs })
  assert.equal(result.code, 1)
  assert.match(result.errorOutput, /批量写入失败|manifest rename failure/)
  assert.equal(await readFile(path.join(rootDir, 'docs/en/page.md'), 'utf8'), englishBefore)
  assert.equal(
    await readFile(path.join(rootDir, 'docs/zh-tw/page.md'), 'utf8'),
    traditionalBefore
  )
  assert.equal(
    await readFile(path.join(rootDir, 'tools', 'content-sync-state.json'), 'utf8'),
    manifestBefore
  )
})

test('--dry-run plans without calling the model or writing files', async (t) => {
  const rootDir = await makeProject(t, {
    'docs/zh-cn/NewFolder/demo.md': '# 演示\n\n正文。\n'
  })
  const fake = fakeModel()
  const result = await run(rootDir, fake, ['--dry-run'])
  assert.equal(result.code, 0, result.errorOutput)
  assert.equal(fake.calls.length, 0)
  assert.match(result.output, /未调用模型/)
  assert.equal(await exists(rootDir, 'docs/zh-cn/NewFolder/index.md'), false)
  assert.equal(await exists(rootDir, 'docs/en/NewFolder/demo.md'), false)
  assert.equal(await exists(rootDir, 'tools/content-sync-state.json'), false)

  const wrappedFake = fakeModel()
  const wrapped = await run(rootDir, wrappedFake, ['--', '--dry-run'])
  assert.equal(wrapped.code, 0, wrapped.errorOutput)
  assert.equal(wrappedFake.calls.length, 0)
  assert.match(wrapped.output, /未调用模型/)
  assert.equal(await exists(rootDir, 'docs/zh-cn/NewFolder/index.md'), false)
  assert.equal(await exists(rootDir, 'docs/en/NewFolder/demo.md'), false)
  assert.equal(await exists(rootDir, 'tools/content-sync-state.json'), false)
})

test('help and invalid options are handled without writes', async (t) => {
  const rootDir = await makeProject(t, {})
  const fake = fakeModel()
  const help = await run(rootDir, fake, ['--help'])
  assert.equal(help.code, 0)
  assert.match(help.output, /content:sync/)
  assert.equal(fake.calls.length, 0)

  const invalid = await run(rootDir, fake, ['--lang', 'fr'])
  assert.equal(invalid.code, 2)
  assert.match(invalid.errorOutput, /--lang/)
  assert.equal(fake.calls.length, 0)

  const unknownAfterSeparator = await run(rootDir, fake, ['--', '--not-an-option'])
  assert.equal(unknownAfterSeparator.code, 2)
  assert.match(unknownAfterSeparator.errorOutput, /未知选项/)
  assert.equal(fake.calls.length, 0)
})
