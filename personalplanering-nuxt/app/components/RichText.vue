<script setup lang="ts">
import { parseRichText } from '~/utils/richText'

// Säker rendering av inklistrad text: stycken och listor byggs som vanliga
// template-noder (ingen v-html), så HTML i texten visas bara som text.
const props = defineProps<{ text: string | null | undefined }>()
const blocks = computed(() => parseRichText(props.text))
</script>

<template>
  <div class="rich-text">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'paragraph'">
        <template v-for="(line, j) in b.lines" :key="j"><br v-if="j > 0">{{ line }}</template>
      </p>
      <ul v-else-if="b.type === 'bullets'">
        <li v-for="(item, j) in b.items" :key="j">{{ item }}</li>
      </ul>
      <ol v-else>
        <li v-for="(item, j) in b.items" :key="j">{{ item }}</li>
      </ol>
    </template>
  </div>
</template>
