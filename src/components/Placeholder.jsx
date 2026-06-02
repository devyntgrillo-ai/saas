export default function Placeholder({ title, description, icon: Icon }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
        {Icon && <Icon className="h-10 w-10 text-slate-600" />}
        <p className="mt-4 text-sm font-medium text-slate-300">Coming next</p>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          This screen is scaffolded and ready to build out in the next step.
        </p>
      </div>
    </div>
  )
}
