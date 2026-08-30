<script setup lang="ts">
const { api } = useApi()
const { users, currentUser, loadAll } = useAppData()
const toast = useToast()

const blank = () => ({
  username: '',
  email: '',
  password: '',
  role: 'member' as 'member' | 'admin',
})

const form = reactive(blank())
const adding = ref(false)

async function add() {
  if (!form.username.trim() || adding.value) return
  adding.value = true
  try {
    await api('POST', '/api/users', {
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    })
    await loadAll()
    Object.assign(form, blank())
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    adding.value = false
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function save(): Promise<boolean> {
  return true
}
defineExpose({ save })
</script>

<template>
  <div class="ob-step">
    <h2>Fler användare</h2>
    <p class="ob-step-lead">
      Lägg till kollegor som ska logga in. Du delar lösenordet med dem manuellt. Kan göras senare.
    </p>

    <ul class="ob-list">
      <li v-for="u in users" :key="u.id" class="ob-list-row">
        <span class="ob-grow">{{ u.username }}</span>
        <span class="ob-muted">
          {{ u.role === 'admin' ? 'Admin' : 'Medlem' }}{{ currentUser && u.id === currentUser.id ? ' (du)' : '' }}
        </span>
      </li>
    </ul>

    <form class="pp-form ob-add-form" @submit.prevent="add">
      <label>Användarnamn *<input v-model="form.username" autocomplete="off"></label>
      <label>E-post<input v-model="form.email" type="email" autocomplete="off"></label>
      <label>Lösenord (minst 8 tecken)<input v-model="form.password" type="text" autocomplete="off"></label>
      <label>Roll
        <select v-model="form.role">
          <option value="member">Medlem</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <div class="modal-actions">
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="adding || !form.username.trim()">Lägg till</button>
      </div>
    </form>
  </div>
</template>
