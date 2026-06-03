import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { LayoutGrid, Settings as SettingsIcon, BarChart3, BookOpen, Users, Rocket } from 'lucide-react'

// One shared tab bar for the entire Reseller portal. Every agency page renders
// it so the tabs are always present and consistent - previously each page had
// its own (different) bar, so navigating between them made the tabs flicker or
// disappear. Agency sub-views (overview / settings) are URL-driven (?tab=).
// Per-practice SMS (Twilio), email (Mailgun), and A2P live under Settings → Messaging.
const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, to: '/agency' },
  { key: 'saas-mode', label: 'SaaS Mode', icon: Rocket, to: '/agency/saas-mode' },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, to: '/agency?tab=settings' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, to: '/agency/analytics' },
  { key: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen, to: '/agency/knowledge-base' },
  { key: 'team', label: 'Team', icon: Users, to: '/agency/team' },
]

export default function AgencyTabs() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()

  // Active tab: a dedicated sub-route wins; otherwise the ?tab on /agency.
  const active =
    pathname.startsWith('/agency/saas-mode') ? 'saas-mode'
    : pathname.startsWith('/agency/analytics') ? 'analytics'
    : pathname.startsWith('/agency/knowledge-base') ? 'knowledge-base'
    : pathname.startsWith('/agency/team') ? 'team'
    : params.get('tab') || 'overview'

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-surface-700">
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            to={t.to}
            className={[
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
              isActive ? 'border-primary text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
            ].join(' ')}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </Link>
        )
      })}
    </div>
  )
}
