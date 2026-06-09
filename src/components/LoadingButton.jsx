import Spinner from './Spinner'

/** Button that shows a spinner and disables while an async action runs. */
export default function LoadingButton({
  loading = false,
  children,
  className = '',
  spinnerClassName,
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className={spinnerClassName || 'h-4 w-4'} /> : null}
      {children}
    </button>
  )
}
