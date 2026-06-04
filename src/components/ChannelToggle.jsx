import { Mail, MessageSquare } from 'lucide-react'

// Email/SMS channel switcher: a segmented control, always visible. Sits on the
// light composer surface - active segment is a solid primary fill (white text),
// the inactive one is muted gray on a soft gray track. No dropdown, no chevron.
const OPTIONS = [
  { value: 'email', label: 'Email', Icon: Mail },
  { value: 'sms', label: 'SMS', Icon: MessageSquare },
]

export default function ChannelToggle({ channel, onSwitch }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = channel === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSwitch(value)}
            aria-pressed={active}
            className={[
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              active
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
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
