import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'

// Native credit-card entry, powered by Helcim.js (script loaded in index.html).
// The card inputs use `id` only (no `name`), so the raw card number is read by
// Helcim.js's helcimProcess() and sent straight to Helcim — it never POSTs to
// our server (PCI-light). On completion Helcim.js fills #helcimResults with
// hidden inputs; we read them via a MutationObserver. The hidden iframe target
// ensures a programmatic form.submit() can never navigate the SPA away.
//
// Config token is a FRONTEND token (tied to a Helcim.js config); set it as
// VITE_HELCIM_JS_TOKEN. Until then this renders a "not configured" notice.

// TODO: TEST MODE ACTIVE — Helcim.js config 10465 has test:1. Flip to test:0 in the
// Helcim dashboard before go-live.
// TODO: enable amount hashing (enforceHashing) in Helcim dashboard config 10465 before go-live.
const HELCIM_JS_TOKEN = import.meta.env.VITE_HELCIM_JS_TOKEN || ''
// Verify-mode config (transactionType: Verify) — tokenizes a card at $0 WITHOUT
// charging, used for "update card on file". Set as VITE_HELCIM_JS_VERIFY_TOKEN.
const HELCIM_JS_VERIFY_TOKEN = import.meta.env.VITE_HELCIM_JS_VERIFY_TOKEN || ''

function readHelcimResults() {
  const box = document.getElementById('helcimResults')
  if (!box) return null
  const get = (id) => box.querySelector(`[id="${id}"]`)?.value ?? ''
  const response = get('response')
  if (!response) return null
  return {
    approved: String(response) === '1',
    response,
    message: get('responseMessage'),
    transactionId: get('transactionId'), // NOTE: Helcim.js form id ≠ Payment-API transactionId; the server resolves the real one by cardToken
    cardToken: get('cardToken'),
    amount: get('amount'),
    date: get('date'), // echoed transaction timestamp — used server-side to scope the verification window
    cardNumberMasked: get('cardNumber'),
    cardType: get('cardType'),
    approvalCode: get('approvalCode'),
    customerCode: get('customerCode'),
  }
}

export default function HelcimCardForm({ amount, submitLabel = 'Pay', onApproved, onDeclined, onError, showAmountInLabel = true, showSecureNote = true, verify = false, customerCode }) {
  const [processing, setProcessing] = useState(false)
  // Verify mode tokenizes the card at $0 (no charge) for card-on-file updates;
  // otherwise it's a purchase. The chosen config token decides which Helcim does.
  const token = verify ? HELCIM_JS_VERIFY_TOKEN : HELCIM_JS_TOKEN
  const configured = Boolean(token)

  useEffect(() => {
    if (!configured) return
    const box = document.getElementById('helcimResults')
    if (!box) return
    const obs = new MutationObserver(() => {
      const res = readHelcimResults()
      if (!res) return
      setProcessing(false)
      if (res.approved) onApproved?.(res)
      else onDeclined?.(res)
      box.innerHTML = '' // reset so a retry can re-fire the observer
    })
    obs.observe(box, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [configured, onApproved, onDeclined])

  function pay() {
    if (typeof window.helcimProcess !== 'function') {
      onError?.('Payment library failed to load — refresh and try again.')
      return
    }
    setProcessing(true)
    try {
      window.helcimProcess()
    } catch (e) {
      setProcessing(false)
      onError?.(e?.message || 'Could not start the payment.')
    }
  }

  if (!configured) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        Card processing isn't configured yet. Set <code>{verify ? 'VITE_HELCIM_JS_VERIFY_TOKEN' : 'VITE_HELCIM_JS_TOKEN'}</code> to enable {verify ? 'card updates' : 'checkout'}.
      </div>
    )
  }

  return (
    <>
      {/* form.submit() (if Helcim.js triggers it) posts into this sink, never navigating. */}
      <iframe name="helcim-sink" title="helcim-sink" style={{ display: 'none' }} />
      <form id="helcimForm" method="POST" action="about:blank" target="helcim-sink" onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <input type="hidden" id="token" defaultValue={token} />
        <input type="hidden" id="language" defaultValue="en" />
        {/* Attach the (verify) tokenized card to the existing Helcim customer so its default can be switched. */}
        {customerCode && <input type="hidden" id="customerCode" defaultValue={customerCode} />}
        {!verify && amount != null && <input type="hidden" id="amount" defaultValue={Number(amount).toFixed(2)} />}

        <div>
          <label className="label">Name on card</label>
          <input type="text" id="cardHolderName" className="input" autoComplete="cc-name" />
        </div>
        <div>
          <label className="label">Card number</label>
          <input type="text" id="cardNumber" className="input" inputMode="numeric" autoComplete="cc-number" placeholder="•••• •••• •••• ••••" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Exp. month</label><input type="text" id="cardExpiryMonth" className="input" inputMode="numeric" placeholder="MM" maxLength={2} /></div>
          <div><label className="label">Exp. year</label><input type="text" id="cardExpiryYear" className="input" inputMode="numeric" placeholder="YY" maxLength={2} /></div>
          <div><label className="label">CVV</label><input type="text" id="cardCVV" className="input" inputMode="numeric" placeholder="•••" maxLength={4} /></div>
        </div>
        <div>
          <label className="label">Billing ZIP</label>
          <input type="text" id="cardHolderPostalCode" className="input" autoComplete="postal-code" />
        </div>

        <div id="helcimResults" style={{ display: 'none' }} />

        <button type="button" id="buttonProcess" onClick={pay} disabled={processing} className="btn-primary w-full justify-center">
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {submitLabel}{showAmountInLabel && amount != null ? ` — $${Number(amount).toLocaleString()}` : ''}
        </button>
        {showSecureNote && (
          <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
            <Lock className="h-3 w-3" /> Secured by Helcim
          </p>
        )}
      </form>
    </>
  )
}
