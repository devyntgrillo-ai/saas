import { Avatar } from './ChatMessage'

// Slack-style "who's in the channel" facepile. Shows up to 5 overlapping avatars
// with a "+N" overflow; hover shows the full list of names.
export default function PresenceBar({ users = [] }) {
  if (!users.length) return null
  const shown = users.slice(0, 5)
  const extra = users.length - shown.length
  const names = users.map((u) => u.name).filter(Boolean).join(', ')

  return (
    <div className="flex items-center gap-2" title={names}>
      <div className="flex -space-x-1.5">
        {shown.map((u) => (
          <div key={u.user_id} className="rounded-lg ring-2 ring-surface-900">
            <Avatar name={u.name} url={u.avatar} team={u.sender_type === 'caselift_team'} size="h-7 w-7" />
          </div>
        ))}
        {extra > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-800 text-[10px] font-semibold text-slate-300 ring-2 ring-surface-900">
            +{extra}
          </span>
        )}
      </div>
      <span className="hidden text-[11px] text-slate-500 sm:inline">
        {users.length} in channel
      </span>
    </div>
  )
}
