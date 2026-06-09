import { Download } from 'lucide-react'
import { useAttachmentUrl } from '../hooks/useAttachmentUrl'

// Renders a conversation attachment bubble. The stored value is a private
// `conversation-attachments` object path (or a legacy public / external URL);
// useAttachmentUrl resolves it to a short-lived signed URL on demand.
export default function ConvAttachment({ attachment, outbound, radius }) {
  const url = useAttachmentUrl('conversation-attachments', attachment?.url)
  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noreferrer"
      download
      className={`flex items-center gap-2 px-3.5 py-2.5 ${radius} ${outbound ? 'bg-[var(--accent)] text-[#fff]' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}
    >
      <Download className="h-4 w-4 shrink-0 opacity-80" />
      <span className="truncate text-sm font-medium underline-offset-2 hover:underline">{attachment?.name || 'Attachment'}</span>
    </a>
  )
}
