import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import KnowledgeBaseAccordion from '../components/KnowledgeBaseAccordion'
import StructuredKnowledgeBase from '../components/StructuredKnowledgeBase'

// Per-practice knowledge base (own practice, or the client an agency is impersonating).
export default function KnowledgeBase() {
  const { practiceId, practice, isAgencyUser, isImpersonating } = useAuth()

  if (isAgencyUser && !isImpersonating) return <Navigate to="/agency/knowledge-base" replace />
  if (!practiceId) return <Navigate to="/" replace />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Knowledge Base</h1>
        <p className="mt-1 text-sm text-slate-400">
          Add your practice details so CaseLift can personalize every message
          {practice?.name ? ` - ${practice.name}` : ''}.
        </p>
      </div>
      <StructuredKnowledgeBase practiceId={practiceId} />
      <KnowledgeBaseAccordion practiceId={practiceId} />
    </div>
  )
}
