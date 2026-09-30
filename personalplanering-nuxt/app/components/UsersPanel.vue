<script setup lang="ts">
import type { User, UserRole } from '~/types'

// Kontoadministration (admin). Samma flöde som onboardingens "Fler
// användare": admin sätter ett lösenord och delar det med personen.
// Personalkonton kopplas uttryckligen till en personalresurs.
const { users, resources, currentUser, loadAll } = useAppData()
const { api } = useApi()
const toast = useToast()

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', member: 'Medlem', employee: 'Personal' }

const blank = () => ({
  username: '',
  email: '',
  password: '',
  phone: '',
  role: 'employee' as UserRole,
  resource_id: '' as number | '',
})
const form = reactive(blank())
const adding = ref(false)

const editing = ref<User | null>(null)
const edit = reactive({ role: 'member' as UserRole, resource_id: '' as number | '', phone: '', password: '', active: true })
const savingEdit = ref(false)

const linkedResourceIds = computed(() => new Set(users.value.map((u) => u.resource_id).filter(Boolean) as number[]))
function freeResources(keepId?: number | null) {
  return resources.value.filter((r) => !linkedResourceIds.value.has(r.id) || r.id === keepId)
}

const sortedUsers = computed(() =>
  [...users.value].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.username.localeCompare(b.username, 'sv'))
)

async function add() {
  if (adding.value) return
  if (form.role === 'employee' && !form.resource_id) {
    toast.add({ title: 'Välj vilken personalresurs kontot gäller.', color: 'error' })
    return
  }
  adding.value = true
  try {
    await api('POST', '/api/users', {
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: form.phone.trim(),
      role: form.role,
      resource_id: form.role === 'employee' ? Number(form.resource_id) : null,
    })
    toast.add({ title: `Kontot ${form.username.trim()} skapades. Dela lösenordet med personen.`, color: 'success' })
    Object.assign(form, blank())
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    adding.value = false
  }
}

function startEdit(u: User) {
  editing.value = u
  Object.assign(edit, {
    role: u.role ?? 'member',
    resource_id: u.resource_id ?? '',
    phone: u.phone ?? '',
    password: '',
    active: u.active !== false,
  })
}

async function saveEdit() {
  if (!editing.value || savingEdit.value) return
  savingEdit.value = true
  try {
    await api('PUT', `/api/users/${editing.value.id}`, {
      role: edit.role,
      resource_id: edit.role === 'employee' ? (edit.resource_id === '' ? null : Number(edit.resource_id)) : null,
      phone: edit.phone.trim(),
      active: edit.active,
      password: edit.password || undefined,
    })
    editing.value = null
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    savingEdit.value = false
  }
}

async function setActive(u: User, active: boolean) {
  if (!active && !confirm(`Avaktivera åtkomsten för ${u.username}? Personen loggas ut direkt.`)) return
  try {
    await api('PUT', `/api/users/${u.id}`, { active })
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <section>
    <h2 class="group-title">Konton</h2>
    <p class="hint">
      Personalkonton loggar in via <strong>/personal/login</strong> och ser bara sina egna inplanerade arbeten och uppgifter.
      Varje personalkonto kopplas till en personalresurs – det är den kopplingen som avgör vilka bokningar personen ser.
    </p>

    <table class="data-table">
      <thead>
        <tr><th>Användarnamn</th><th>Roll</th><th>Personalresurs</th><th>Telefon</th><th>Status</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="u in sortedUsers" :key="u.id">
          <td data-label="Användarnamn">
            {{ u.username }}<span v-if="currentUser && u.id === currentUser.id" class="hint"> (du)</span>
          </td>
          <td data-label="Roll">{{ ROLE_LABELS[u.role ?? 'member'] }}</td>
          <td data-label="Personalresurs">
            <template v-if="u.role === 'employee'">
              {{ u.resource_name || '' }}<span v-if="!u.resource_id" class="hint">Ej kopplad – ingen åtkomst till arbeten</span>
            </template>
            <span v-else class="hint">–</span>
          </td>
          <td data-label="Telefon">{{ u.phone || '–' }}</td>
          <td data-label="Status">
            <span class="badge" :class="u.active === false ? 'avslutad' : 'aktiv'">{{ u.active === false ? 'Avaktiverad' : 'Aktiv' }}</span>
          </td>
          <td data-label="">
            <button class="plain ghost" @click="startEdit(u)">Redigera</button>
            <template v-if="!currentUser || u.id !== currentUser.id">
              <button v-if="u.active !== false" class="plain danger" @click="setActive(u, false)">Avaktivera</button>
              <button v-else class="plain" @click="setActive(u, true)">Återaktivera</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 class="group-title">Nytt konto</h2>
    <form class="pp-form" style="max-width: 520px" @submit.prevent="add">
      <label>Roll
        <select v-model="form.role">
          <option value="employee">Personal (ser bara egna arbeten)</option>
          <option value="member">Medlem</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label v-if="form.role === 'employee'">Personalresurs *
        <select v-model="form.resource_id" required>
          <option value="">Välj person…</option>
          <option v-for="r in freeResources()" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <label>Användarnamn *<input v-model="form.username" autocomplete="off" autocapitalize="none" required></label>
      <label>E-post<input v-model="form.email" type="email" autocomplete="off"></label>
      <label>Telefon<input v-model="form.phone" autocomplete="off"></label>
      <label>Lösenord (minst 8 tecken) *<input v-model="form.password" type="text" autocomplete="off" required></label>
      <div class="modal-actions">
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="adding || !form.username.trim()">Skapa konto</button>
      </div>
    </form>

    <UModal :open="!!editing" :title="`Redigera ${editing?.username ?? ''}`" @update:open="(v: boolean) => { if (!v) editing = null }">
      <template #body>
        <form class="pp-form" @submit.prevent="saveEdit">
          <label>Roll
            <select v-model="edit.role" :disabled="!!currentUser && editing?.id === currentUser.id">
              <option value="employee">Personal</option>
              <option value="member">Medlem</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label v-if="edit.role === 'employee'">Personalresurs
            <select v-model="edit.resource_id">
              <option value="">Ingen koppling (ingen åtkomst till arbeten)</option>
              <option v-for="r in freeResources(editing?.resource_id)" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <label>Telefon (visas för personal när du är projektledare)<input v-model="edit.phone" autocomplete="off"></label>
          <label>Nytt lösenord (lämna tomt för att behålla)<input v-model="edit.password" type="text" autocomplete="off"></label>
          <label v-if="!currentUser || editing?.id !== currentUser.id" class="checkbox-label">
            <input v-model="edit.active" type="checkbox"> Aktivt konto
          </label>
          <div class="modal-actions">
            <div class="spacer" />
            <button type="button" class="plain ghost" @click="editing = null">Avbryt</button>
            <button type="submit" class="plain primary" :disabled="savingEdit">Spara</button>
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
