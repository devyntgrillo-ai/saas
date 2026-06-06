import { Mail, MessageSquare } from 'lucide-react'

// Email/SMS channel switcher: a segmented control. Theme-aware via the surface
// tokens so it reads correctly in both light and dark mode. Active segment =
// solid brand primary with white text/icon; inactive = muted text on the track.
// No dropdown, no chevron.
//
// NOTE: the active text color is set inline (#fff) rather than via the
// `text-white` utility, because index.css has a light-mode override
// (`:root:not(.dark) .text-white { color: var(--text-primary) }`) that would
// otherwise flip it to near-black — i.e. dark text on the blue fill.
const OPTIONS = [
  { value: 'sms', label: 'SMS', Icon: MessageSquare },
  { value: 'email', label: 'Email', Icon: Mail },
]

export default function ChannelToggle({ channel, onSwitch }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-surface-700 bg-surface-800 p-1">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = channel === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSwitch(value)}
            aria-pressed={active}
            style={active ? { color: '#fff' } : undefined}
            className={[
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              active
                ? 'bg-primary shadow-sm'
                : 'text-[var(--text-secondary)] hover:bg-surface-900 hover:text-[var(--text-primary)]',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
