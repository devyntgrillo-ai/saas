import { AnimatePresence, motion } from 'framer-motion'

// Animated "…is typing" row. `users` is the list of active typing rows (already
// filtered to exclude the current user).
export default function TypingIndicator({ users = [] }) {
  const names = users.map((u) => u.name || u.sender_name).filter(Boolean)
  let label = ''
  if (names.length === 1) label = `${names[0]} is typing`
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing`
  else if (names.length >= 3) label = 'Several people are typing'

  return (
    <AnimatePresence>
      {names.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-2 px-1 py-1 text-xs text-slate-400"
        >
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </span>
          <span>{label}…</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
