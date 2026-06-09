import { useState } from 'react'
import { Eye, EyeOff, Check, X } from 'lucide-react'
import { checkPasswordRules, passwordStrength, PASSWORD_RULE_LABELS } from '../lib/passwordPolicy'

// A password <input> with a show/hide toggle, a strength meter, and a live
// per-requirement checklist. Used in the signup and password-reset flows so the
// HIPAA password policy is surfaced consistently. Controlled: pass value/onChange.
//
// onChange receives the raw string (not the event) for convenience.
export default function PasswordField({
  id = 'password',
  value,
  onChange,
  label = 'Password',
  placeholder = 'Create a strong password',
  autoComplete = 'new-password',
  showMeter = true,
  showChecklist = true,
  required = true,
  disabled = false,
}) {
  const [show, setShow] = useState(false)
  const rules = checkPasswordRules(value || '')
  const { score, label: strengthLabel, percent } = passwordStrength(value || '')

  // green when all rules pass; otherwise track the rough strength score.
  const barColor =
    score <= 1 ? 'bg-rose-500' : score === 2 ? 'bg-amber-500' : score === 3 ? 'bg-lime-500' : 'bg-emerald-500'
  const labelColor =
    score <= 1 ? 'text-rose-300' : score === 2 ? 'text-amber-300' : score === 3 ? 'text-lime-300' : 'text-emerald-300'

  return (
    <div>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          className="input pr-10"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition hover:text-slate-300"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showMeter && value && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-700">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.max(percent, 8)}%` }}
            />
          </div>
          <p className={`mt-1 text-xs font-medium ${labelColor}`}>Password strength: {strengthLabel}</p>
        </div>
      )}

      {showChecklist && value && (
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {Object.entries(PASSWORD_RULE_LABELS).map(([key, text]) => {
            const ok = rules[key]
            return (
              <li
                key={key}
                className={`flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-300' : 'text-slate-500'}`}
              >
                {ok ? <Check className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />}
                {text}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
