import {
  Lock, Users, Trophy, Heart, MessageCircle, Pin, Flame, Medal, Search, Bell,
} from 'lucide-react'

// ============================================================================
// Community - a locked "coming soon" teaser. The Skool-style preview (feed +
// leaderboards of treatment coordinators and practices) is rendered behind a
// blur, then covered with a Coming Soon overlay. All data here is mock/decorative
// and the preview is non-interactive (pointer-events-none / select-none).
// ============================================================================

const AVATAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500',
]
function avatarColor(seed) {
  let h = 0
  for (let i = 0; i < (seed || '?').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name) {
  const [a, b] = (name || '?').split(' ')
  return `${(a || '?')[0]}${(b || '')[0] || ''}`.toUpperCase()
}

function Avatar({ name, size = 'h-9 w-9 text-xs' }) {
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full font-semibold !text-white ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  )
}

const TABS = ['Community', 'Classroom', 'Leaderboards', 'Members', 'Calendar']

const POSTS = [
  {
    name: 'Jasmine Carter', practice: 'Perry Family Dentistry', time: '2h', cat: 'Wins', pinned: true,
    title: 'Closed a $42k full-arch case after a 3-message reactivation sequence 🎉',
    body: 'Patient ghosted us for 5 months. The price-lock angle from the playbook brought her back. Sharing the exact script in the comments.',
    likes: 128, comments: 34,
  },
  {
    name: 'Marcus Bell', practice: 'Cascade Implant Center', time: '5h', cat: 'Objection Help',
    title: 'How do you handle "I need to talk to my spouse" without losing momentum?',
    body: 'Tried the joint-call offer but they keep stalling. What’s working for you all?',
    likes: 61, comments: 47,
  },
  {
    name: 'Dana Whitfield', practice: 'Blue Sky Dental', time: '1d', cat: 'Scripts',
    title: 'My exact financing breakdown text (copy/paste)',
    body: 'This single message took our consult-to-schedule rate from 38% to 56% last quarter.',
    likes: 203, comments: 58,
  },
]

const TC_LEADERS = [
  { name: 'Dana Whitfield', practice: 'Blue Sky Dental', pts: 1840 },
  { name: 'Jasmine Carter', practice: 'Perry Family Dentistry', pts: 1620 },
  { name: 'Marcus Bell', practice: 'Cascade Implant Center', pts: 1475 },
  { name: 'Priya Nair', practice: 'Summit Oral Surgery', pts: 1290 },
  { name: 'Tom Alvarez', practice: 'Northwest Implant Group', pts: 1118 },
  { name: 'Riley Chen', practice: 'Pacific Dental Partners', pts: 980 },
]

const PRACTICE_LEADERS = [
  { name: 'Blue Sky Dental', pts: 8920 },
  { name: 'Perry Family Dentistry', pts: 8410 },
  { name: 'Cascade Implant Center', pts: 7655 },
  { name: 'Summit Oral Surgery', pts: 6980 },
  { name: 'Northwest Implant Group', pts: 6240 },
]

const MEDAL = ['text-amber-400', 'text-slate-300', 'text-orange-400']

function Rank({ i }) {
  if (i < 3) return <Medal className={`h-4 w-4 ${MEDAL[i]}`} />
  return <span className="w-4 text-center text-xs font-semibold text-slate-500">{i + 1}</span>
}

function LeaderRow({ i, name, sub, pts }) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <Rank i={i} />
      <Avatar name={name} size="h-7 w-7 text-[10px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{name}</p>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
      </div>
      <span className="shrink-0 text-sm font-semibold text-primary-300">{pts.toLocaleString()}</span>
    </div>
  )
}

function LeaderCard({ icon: Icon, title, rows }) {
  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="divide-y divide-surface-700/70">
        {rows.map((r, i) => (
          <LeaderRow key={r.name} i={i} name={r.name} sub={r.practice} pts={r.pts} />
        ))}
      </div>
    </div>
  )
}

export default function Community() {
  return (
    <div className="relative">
      {/* ── Blurred, non-interactive Skool-style preview ─────────────────── */}
      <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-50" >
        {/* Header / banner */}
        <div className="overflow-hidden rounded-2xl border border-surface-700">
          <div className="h-24 bg-gradient-to-r from-primary/40 via-indigo-500/30 to-fuchsia-500/30" />
          <div className="flex items-end justify-between gap-3 px-5 pb-4">
            <div className="-mt-7 flex items-end gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-surface-700 bg-surface-800 text-primary-300">
                <Users className="h-7 w-7" />
              </div>
              <div className="pb-1">
                <h1 className="text-lg font-bold text-white">Hope AI Community</h1>
                <p className="text-xs text-slate-400">4,812 members · 213 online</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 pb-1 sm:flex">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <div className="h-8 w-40 rounded-lg border border-surface-700 bg-surface-800/60 pl-8" />
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-700 bg-surface-800/60 text-slate-400"><Bell className="h-4 w-4" /></div>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-5 border-t border-surface-700 px-5">
            {TABS.map((t, i) => (
              <span key={t} className={`-mb-px border-b-2 py-2.5 text-sm ${i === 0 ? 'border-primary font-medium text-white' : 'border-transparent text-slate-400'}`}>{t}</span>
            ))}
          </div>
        </div>

        {/* Body: feed + leaderboard sidebar */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Feed */}
          <div className="space-y-4 lg:col-span-2">
            {/* Composer */}
            <div className="card flex items-center gap-3 p-4">
              <Avatar name="You There" />
              <div className="h-10 flex-1 rounded-lg border border-surface-700 bg-surface-800/60" />
              <div className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold !text-white">Post</div>
            </div>

            {POSTS.map((p) => (
              <div key={p.title} className="card p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">{p.practice} · {p.time}</p>
                  </div>
                  <span className="rounded-full bg-surface-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">{p.cat}</span>
                  {p.pinned && <Pin className="h-3.5 w-3.5 text-amber-400" />}
                </div>
                <h3 className="mt-3 text-base font-semibold text-white">{p.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{p.body}</p>
                <div className="mt-3 flex items-center gap-5 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5"><Heart className="h-4 w-4 text-rose-400" /> {p.likes}</span>
                  <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> {p.comments}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar leaderboards */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Flame className="h-4 w-4 text-orange-400" /> Your rank this month
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-2xl font-bold text-white">#37</span>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-surface-700"><div className="h-2 w-2/3 rounded-full bg-primary" /></div>
                  <p className="mt-1 text-xs text-slate-500">Level 4 · 240 pts to Level 5</p>
                </div>
              </div>
            </div>
            <LeaderCard icon={Trophy} title="Top Treatment Coordinators" rows={TC_LEADERS} />
            <LeaderCard icon={Trophy} title="Top Practices" rows={PRACTICE_LEADERS} />
          </div>
        </div>
      </div>

      {/* ── Coming Soon overlay ──────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-surface-950/40" />
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-surface-700 bg-surface-900/90 p-8 text-center shadow-2xl backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary-300">
            <Lock className="h-7 w-7" />
          </div>
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-300">
            Coming soon
          </span>
          <h2 className="mt-3 text-xl font-bold text-white">Community</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            Connect with treatment coordinators and practices across the network - share scripts and wins,
            ask for objection help, and climb the leaderboard. We're putting the finishing touches on it.
          </p>
          <button
            type="button"
            disabled
            className="mt-5 inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-surface-800 px-4 py-2.5 text-sm font-semibold text-slate-400"
          >
            <Bell className="h-4 w-4" /> We'll let you know when it's live
          </button>
        </div>
      </div>
    </div>
  )
}
