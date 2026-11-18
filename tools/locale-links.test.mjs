import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectLocaleLinkTargets,
  isAssetTarget,
  localeLinkIssues,
  localeTargetIssue
} from './locale-links.mjs'

test('collects Markdown, reference, HTML, and frontmatter destinations', () => {
  const text = [
    '---',
    'hero:',
    '  actions:',
    '    - link: /zh-cn/About/',
    'image:',
    '  src: /images/pic.png',
    '---',
    '',
    '[笔记](/zh-cn/Notes/) 与 ![图](/images/pic.png)',
    '',
    '<a href="/zh-cn/Projects/">项目</a>',
    '',
    '[ref]: /zh-cn/Notes/Courses/',
    ''
  ].join('\n')

  assert.deepEqual(
    collectLocaleLinkTargets(text).filter((target) => target.startsWith('/')).sort(),
    [
      '/images/pic.png',
      '/images/pic.png',
      '/zh-cn/About/',
      '/zh-cn/Notes/',
      '/zh-cn/Notes/Courses/',
      '/zh-cn/Projects/'
    ]
  )
})

test('links inside code and formulas are not navigation', () => {
  const text = [
    '```md',
    '[fake](/zh-cn/A)',
    '```',
    '',
    '`[inline](/zh-cn/B)` 和 $[math](/zh-cn/C)$',
    ''
  ].join('\n')
  assert.deepEqual(collectLocaleLinkTargets(text), [])
})

test('locale prefixes must match the page locale', () => {
  assert.deepEqual(localeLinkIssues('[x](/en/A)', 'en', 'p'), [])
  assert.match(
    localeLinkIssues('[x](/zh-cn/A)', 'en', 'p')[0],
    /语言前缀与 \/en\/ 不一致/
  )
  assert.match(
    localeLinkIssues('[x](/en/A)', 'zh-tw', 'p')[0],
    /语言前缀与 \/zh-tw\/ 不一致/
  )
  assert.match(
    localeLinkIssues('[x](/zh-cn/A)', 'zh-tw', 'p')[0],
    /语言前缀与 \/zh-tw\/ 不一致/
  )
  assert.match(localeLinkIssues('[x](/Notes/)', 'en', 'p')[0], /必须指向 \/en\//)
})

test('root chooser, assets, anchors, relative, and external links are allowed', () => {
  const text = [
    '[home](/)',
    '[asset](/favicon.svg)',
    '[image](/images/中文图片.png)',
    '[anchor](#section)',
    '[relative](./demo.md)',
    '[external](https://example.com/en/)',
    '[mail](mailto:a@example.com)',
    '[protocol](//cdn.example.com/x.js)',
    '<img src="/images/pic.png">',
    ''
  ].join('\n')
  assert.deepEqual(localeLinkIssues(text, 'en', 'p'), [])
})

test('assets are identified by extension without hiding page routes', () => {
  assert.equal(isAssetTarget('/images/pic.png'), true)
  assert.equal(isAssetTarget('/styles/site.css?x=1'), true)
  assert.equal(isAssetTarget('/Notes/demo'), false)
  assert.equal(isAssetTarget('/Notes/demo.html'), false)
  assert.equal(localeTargetIssue('/images/pic.png', 'zh-tw'), null)
  assert.match(localeTargetIssue('/Notes/demo', 'zh-tw'), /必须指向 \/zh-tw\//)
})

test('localeLinkIssues rejects unsupported locale names', () => {
  assert.match(localeLinkIssues('[x](/en/A)', 'fr', 'p')[0], /不支持的语言/)
})

test('malformed Markdown fails closed instead of reporting a passing link set', () => {
  const issues = localeLinkIssues('<a href="/en/A"', 'en', 'p')
  assert.equal(issues.length, 1)
  assert.match(issues[0], /无法解析站内链接/)
})
