export default function StatCard({ label, value, icon: Icon, accent = 'primary', hint }) {
  // Production-recovered is the single color exception (success green).
  const valueColor = accent === 'green' ? 'text-[#10b981]' : 'text-slate-100'

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className={`mt-2 text-2xl font-bold tracking-tight ${valueColor}`}>{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} />}
      </div>
    </div>
  )
}
