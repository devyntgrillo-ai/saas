// Email/SMS channel switcher: two toggle buttons, always visible side by side.
// The active channel is filled (primary/blue), the inactive one is ghost/outlined.
// No dropdown, no chevron. Used by both the Email and SMS composers.
export default function ChannelToggle({ channel, onSwitch }) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition'
  const active = 'bg-blue-600 text-white shadow-sm'
  const inactive = 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        onClick={() => onSwitch('email')}
        className={`${base} ${channel === 'email' ? active : inactive}`}
      >
        📧 Email
      </button>
      <button
        type="button"
        onClick={() => onSwitch('sms')}
        className={`${base} ${channel === 'sms' ? active : inactive}`}
      >
        💬 SMS
      </button>
    </div>
  )
}
