import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFrontmatterScalars, translateFrontmatter } from './frontmatter-translate.mjs'

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
    '      text: 博客与笔记',
    '      link: /zh-cn/Blogs/',
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
      if (value === '博客与笔记') return 'Blogs and notes'
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
  assert.match(translated, /link: \/Blogs\//)
  assert.match(translated, /link: \/About\//)
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
    '      link: /zh-cn/Blogs/'
  ])
  const requestModel = async () => {
    throw new Error('model must not be called')
  }
  const translated = await translateFrontmatter(source, { requestModel, sourcePath: 'x' })
  assert.match(translated, /text: English already/)
  assert.match(translated, /link: \/Blogs\//)
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
