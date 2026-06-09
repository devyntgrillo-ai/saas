import { Loader2 } from 'lucide-react'

/** Inline loading indicator for buttons, icons, and compact UI slots. */
export default function Spinner({ className = 'h-4 w-4', ...props }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden {...props} />
}
