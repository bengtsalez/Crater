/**
 * Reaktivt "dagens datum". Ersätter mönstret `const today = new Date()` som
 * fryser datumet för komponentens livstid – lämnas en vy öppen över midnatt
 * fortsätter annars beräkningar använda gårdagens datum.
 *
 * Uppdateras varje minut samt när fliken/fönstret återfår fokus.
 */
export function useToday() {
  const today = useState<Date>('today:current', () => new Date())

  onMounted(() => {
    const tick = () => {
      const now = new Date()
      if (now.toDateString() !== today.value.toDateString()) today.value = now
    }
    const id = window.setInterval(tick, 60_000)
    window.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    onBeforeUnmount(() => {
      window.clearInterval(id)
      window.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    })
  })

  return today
}
