<script setup lang="ts">
import { onMounted } from 'vue'
import { withBase } from 'vitepress'
import { resolveRootRedirect } from './language-preference.mjs'

const englishHref = withBase('/en/')
const languages = [
    { href: withBase('/en/'), label: 'English', lang: 'en-US' },
    { href: withBase('/zh-cn/'), label: '简体中文', lang: 'zh-CN' },
    { href: withBase('/zh-tw/'), label: '繁體中文', lang: 'zh-TW' }
]

onMounted(() => {
    const target = resolveRootRedirect({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        languages: navigator.languages?.length
            ? navigator.languages
            : [navigator.language],
        base: withBase('/')
    })

    if (target !== null) window.location.replace(target)
})
</script>

<template>
  <section class="browser-language-entry" aria-labelledby="browser-language-title">
    <h2 id="browser-language-title">Choose a language</h2>
    <p>
      With JavaScript enabled, the site opens in your browser's preferred
      language. You can also choose one explicitly.
    </p>
    <ul class="language-links">
      <li v-for="language in languages" :key="language.href">
        <a :href="language.href" :hreflang="language.lang" :lang="language.lang">
          {{ language.label }}
        </a>
      </li>
    </ul>
    <p class="english-fallback">
      If you prefer not to choose, continue in
      <a :href="englishHref" hreflang="en-US" lang="en-US">English</a>.
    </p>
  </section>
</template>

<style scoped>
.browser-language-entry {
  max-width: 42rem;
  margin: 2rem 0;
  padding: 1.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.browser-language-entry h2 {
  margin-top: 0;
  border-top: 0;
  padding-top: 0;
}

.language-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 1rem 0;
  padding: 0;
  list-style: none;
}

.language-links a {
  display: inline-block;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  font-weight: 600;
}

.language-links a:hover {
  border-color: var(--vp-c-brand-1);
}

.english-fallback {
  margin-bottom: 0;
}
</style>
