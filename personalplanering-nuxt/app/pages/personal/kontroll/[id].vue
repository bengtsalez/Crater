<script setup lang="ts">
// Personalens ifyllnad av en tilldelad egenkontroll/checklista. Servern
// kräver både bokning på projektet och uttrycklig tilldelning (annars 404).
definePageMeta({ layout: 'employee' })

const route = useRoute()
const id = computed(() => Number(route.params.id))
const backTo = computed(() => (typeof route.query.arbete === 'string' ? `/personal/arbete/${route.query.arbete}` : '/personal'))
</script>

<template>
  <section class="emp-page ik-emp">
    <NuxtLink :to="backTo" class="emp-back">‹ Tillbaka till arbetet</NuxtLink>
    <InspectionsInspectionForm :base="`/api/employee/inspections/${id}`" mode="employee" />
  </section>
</template>
