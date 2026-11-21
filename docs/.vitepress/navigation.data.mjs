import { defineLoader } from 'vitepress'
import { buildNotesCatalog } from './navigation.mjs'

/*
 * Notes indexes render from this loader instead of a hand-written list.
 * The loader is server-only: VitePress replaces it with serialized data for
 * the browser. Its watch patterns make new or edited Notes pages refresh in
 * dev; production builds read the same deterministic catalog.
 */
export default defineLoader({
  watch: [
    '../en/Notes/**/*.md',
    '../zh-cn/Notes/**/*.md',
    '../zh-tw/Notes/**/*.md'
  ],
  load() {
    return buildNotesCatalog()
  }
})
