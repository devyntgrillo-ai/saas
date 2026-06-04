// Neutral full-screen loader while auth context (profile, practice, BAA) resolves.
export default function AuthLoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-surface">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
    </div>
  )
}
