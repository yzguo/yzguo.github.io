import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MermaidTranslationError,
  findMermaidFences,
  restoreMermaidBlocks,
  translateMermaidBlocks,
  translateMermaidSource
} from './mermaid-translate.mjs'

function fakeModel(translations, options = {}) {
  const prompts = []
  async function requestModel({ prompt }) {
    prompts.push(prompt)
    if (options.error) throw new Error(options.error)
    const match = prompt.match(/<<<MERMAID LABELS [^>]+>>>\n([\s\S]*?)\n<<<END/)
    if (!match) throw new Error('missing Mermaid labels')
    const values = JSON.parse(match[1])
    const output = values.map((value) => translations[value] ?? value)
    if (options.mutate) return options.mutate(output)
    return JSON.stringify(output)
  }
  return { requestModel, prompts }
}

function franceFlow() {
  return [
    '---',
    'title: 中文标题',
    '---',
    'flowchart TD',
    '  A[小角度] --> B[运动方程]',
    '  B -->|推导| C[周期 T]',
    '  C --> D{是否小角度?}',
    '  subgraph exp["实验组"]',
    '    E[[开始]]',
    '  end',
    '  A -- 文字 --> B',
    '  %% 中文注释保留',
    '  classDef note fill:#fff'
  ].join('\n')
}

test('flowchart labels translate while ids, arrows, shapes, and comments stay exact', async () => {
  const model = fakeModel({
    '小角度': 'Small angle',
    '运动方程': 'Equation of motion',
    '推导': 'Derivation',
    '周期 T': 'Period T',
    '是否小角度?': 'Is the angle small?',
    '实验组': 'Experimental group',
    '开始': 'Start',
    '文字': 'text',
    '中文标题': 'Chinese title'
  })
  const translated = await translateMermaidSource(franceFlow(), {
    requestModel: model.requestModel,
    sourcePath: 'docs/zh-cn/index.md'
  })

  assert.match(translated, /title: Chinese title/)
  assert.match(translated, /A\[Small angle\] --> B\[Equation of motion\]/)
  assert.match(translated, /B -->\|Derivation\| C\[Period T\]/)
  assert.match(translated, /C --> D\{Is the angle small\?\}/)
  assert.match(translated, /subgraph exp\["Experimental group"\]/)
  assert.match(translated, /E\[\[Start\]\]/)
  assert.match(translated, /A -- text --> B/)
  assert.match(translated, /%% 中文注释保留/)
  assert.match(translated, /classDef note fill:#fff/)

  const prompt = model.prompts.join('\n')
  assert.match(prompt, /小角度/)
  assert.doesNotMatch(prompt, /flowchart TD|-->|subgraph|classDef|%%/)
})

test('arrow tails are never parsed as node ids', async () => {
  const source = 'flowchart LR\n A[开始] --> B[结束]'
  const model = fakeModel({ '开始': 'Start', '结束': 'End' })
  const translated = await translateMermaidSource(source, {
    requestModel: model.requestModel,
    sourcePath: 'docs/zh-cn/index.md'
  })

  assert.equal(translated, 'flowchart LR\n A[Start] --> B[End]')
  assert.match(model.prompts[0], /"开始"/)
  assert.match(model.prompts[0], /"结束"/)
  assert.doesNotMatch(model.prompts[0], /B\[结束/)
})

test('sequence diagram participant, message, note, and control labels translate', async () => {
  const source = [
    'sequenceDiagram',
    '  participant A as 用户',
    '  participant B as 服务器',
    '  A->>B: 请求数据',
    '  B-->>A: 返回结果',
    '  Note over A,B: 提示',
    '  loop 每次请求',
    '    A->>B: 再次请求',
    '  end'
  ].join('\n')
  const model = fakeModel({
    '用户': 'User',
    '服务器': 'Server',
    '请求数据': 'Request data',
    '返回结果': 'Return result',
    '提示': 'Notice',
    '每次请求': 'each request',
    '再次请求': 'request again'
  })
  const translated = await translateMermaidSource(source, {
    requestModel: model.requestModel,
    sourcePath: 'docs/zh-cn/demo.md'
  })

  assert.match(translated, /participant A as User/)
  assert.match(translated, /participant B as Server/)
  assert.match(translated, /A->>B: Request data/)
  assert.match(translated, /B-->>A: Return result/)
  assert.match(translated, /Note over A,B: Notice/)
  assert.match(translated, /loop each request/)
  assert.match(translated, /A->>B: request again/)
})

test('state diagram quoted states and transition/note text translate', async () => {
  const source = [
    'stateDiagram-v2',
    '  [*] --> Idle',
    '  Idle --> Running: 启动',
    '  state "处理中" as Processing',
    '  note right of Processing: 正在处理'
  ].join('\n')
  const model = fakeModel({
    '启动': 'Start',
    '处理中': 'Processing',
    '正在处理': 'Processing now'
  })
  const translated = await translateMermaidSource(source, {
    requestModel: model.requestModel,
    sourcePath: 'docs/zh-cn/demo.md'
  })

  assert.match(translated, /Idle --> Running: Start/)
  assert.match(translated, /state "Processing" as Processing/)
  assert.match(translated, /note right of Processing: Processing now/)
})

test('unsafe or unsupported Chinese Mermaid content fails explicitly', async () => {
  const model = fakeModel({})
  await assert.rejects(
    translateMermaidSource('pie title 中文\n  "中文" : 42', {
      requestModel: model.requestModel,
      sourcePath: 'x'
    }),
    /暂不支持安全翻译/
  )
  await assert.rejects(
    translateMermaidSource('flowchart TD\n  A --> 中文节点', {
      requestModel: model.requestModel,
      sourcePath: 'x'
    }),
    /无法安全定位/
  )
  await assert.rejects(
    translateMermaidSource('flowchart TD\n  A[小角度] --> B', {
      requestModel: fakeModel({ '小角度': '小角度' }).requestModel,
      sourcePath: 'x'
    }),
    /未能安全翻译/
  )
})

test('wrong model output count and structure-breaking labels fail', async () => {
  const source = 'flowchart TD\n  A[小角度] --> B[运动方程]'
  await assert.rejects(
    translateMermaidSource(source, {
      requestModel: fakeModel({}, {
        mutate: () => JSON.stringify(['Only one'])
      }).requestModel,
      sourcePath: 'x'
    }),
    /期望 2 条/
  )
  await assert.rejects(
    translateMermaidSource(source, {
      requestModel: fakeModel({ '小角度': 'Small ] angle', '运动方程': 'Equation' }).requestModel,
      sourcePath: 'x'
    }),
    /破坏图语法/
  )
})

test('Mermaid fences are replaced by placeholders and restored exactly once', async () => {
  const body = [
    '# 标题',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[小角度] --> B',
    '```',
    '',
    '正文。'
  ].join('\n')
  const model = fakeModel({ '小角度': 'Small angle' })
  const prepared = await translateMermaidBlocks(body, {
    requestModel: model.requestModel,
    sourcePath: 'docs/zh-cn/demo.md'
  })
  assert.doesNotMatch(prepared.body, /flowchart|小角度/)
  assert.equal(prepared.tokens.length, 1)

  const translated = prepared.body.replace('正文。', 'Body.')
  const restored = restoreMermaidBlocks(translated, prepared.tokens)
  assert.match(restored, /```mermaid\nflowchart TD\n  A\[Small angle\] --> B\n```/)
  assert.throws(
    () => restoreMermaidBlocks(translated.replace(prepared.tokens[0].token, ''), prepared.tokens),
    /丢失/
  )
})

test('an unclosed Mermaid fence fails instead of silently passing through', () => {
  assert.throws(
    () => findMermaidFences('```mermaid\nflowchart TD\n  A --> B'),
    MermaidTranslationError
  )
})
