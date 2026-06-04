#!/usr/bin/env node
/**
 * One-off A2P resubmit for a practice (Trust Product + Brand + Campaign + DB update).
 * Usage: TWILIO_API_KEY_SID=... TWILIO_API_KEY_SECRET=... node scripts/resubmit-a2p.mjs <practice_id>
 */
import { execSync } from 'node:child_process'

const PRACTICE_ID = process.argv[2] || 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1'
const SK = process.env.TWILIO_API_KEY_SID
const SECRET = process.env.TWILIO_API_KEY_SECRET
const NOTIFY_EMAIL = process.env.TWILIO_TRUSTHUB_NOTIFICATION_EMAIL || 'devyntgrillo@gmail.com'
// ISV primary only — never use as practice secondary/customer bundle
const PRIMARY_PROFILE_SID = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID || ''
const A2P_TRUST_PRODUCT_POLICY = 'RNb0d4771c2c98518d916a3d4cd70a8f8b'

if (!SK || !SECRET) {
  console.error('Set TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET')
  process.exit(1)
}

const auth = Buffer.from(`${SK}:${SECRET}`).toString('base64')
const hdr = { Authorization: `Basic ${auth}` }
const formHdr = { ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' }

async function twilio(host, path, { method = 'GET', body } = {}) {
  const url = `https://${host}${path}`
  const res = await fetch(url, {
    method,
    headers: body ? formHdr : hdr,
    body,
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  if (!res.ok) throw new Error(`Twilio ${res.status} ${path}: ${data.message || text}`)
  return data
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function throttle() {
  await sleep(1100)
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''")
}

function dbQuery(sql) {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  const out = execSync(`npx supabase db query --linked --output json ${JSON.stringify(oneLine)}`, {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url).pathname,
    maxBuffer: 10 * 1024 * 1024,
  })
  const parsed = JSON.parse(out)
  return parsed.rows
}

async function main() {
  const rows = dbQuery(
    `SELECT id, name, twilio_messaging_service_sid, twilio_phone_sid, a2p_config
     FROM public.practices WHERE id = '${sqlEscape(PRACTICE_ID)}'`,
  )
  const practice = rows[0]
  if (!practice) throw new Error('Practice not found')
  const cfg = practice.a2p_config || {}
  const mgSid = practice.twilio_messaging_service_sid
  if (!mgSid) throw new Error('No messaging service on practice')

  const label = (practice.name || cfg.legal_name || 'Practice').slice(0, 40)
  let customerProfileSid = cfg.trust_hub?.customer_profile_sid || null
  if (customerProfileSid && PRIMARY_PROFILE_SID && customerProfileSid === PRIMARY_PROFILE_SID) {
    customerProfileSid = null
  }
  let trustProductSid = cfg.trust_hub?.trust_product_sid

  console.log('Practice:', practice.name, 'MG:', mgSid)
  console.log('Customer profile:', customerProfileSid)

  if (!trustProductSid) {
    const tpForm = new URLSearchParams()
    tpForm.set('FriendlyName', `Hope AI - ${label} A2P Trust`.slice(0, 64))
    tpForm.set('Email', NOTIFY_EMAIL)
    tpForm.set('PolicySid', A2P_TRUST_PRODUCT_POLICY)
    const tp = await twilio('trusthub.twilio.com', '/v1/TrustProducts', {
      method: 'POST',
      body: tpForm.toString(),
    })
    trustProductSid = tp.sid
    console.log('Created TrustProduct:', trustProductSid, tp.status)
    await throttle()

    const euForm = new URLSearchParams()
    euForm.set('FriendlyName', `${label} A2P Profile`.slice(0, 64))
    euForm.set('Type', 'us_a2p_messaging_profile_information')
    euForm.set(
      'Attributes',
      JSON.stringify({
        company_type: 'private',
        brand_contact_email: cfg.contact_email || NOTIFY_EMAIL,
      }),
    )
    const eu = await twilio('trusthub.twilio.com', '/v1/EndUsers', { method: 'POST', body: euForm.toString() })
    await throttle()

    const assign1 = new URLSearchParams()
    assign1.set('ObjectSid', eu.sid)
    await twilio('trusthub.twilio.com', `/v1/TrustProducts/${trustProductSid}/EntityAssignments`, {
      method: 'POST',
      body: assign1.toString(),
    })
    await throttle()

    const assign2 = new URLSearchParams()
    assign2.set('ObjectSid', customerProfileSid)
    await twilio('trusthub.twilio.com', `/v1/TrustProducts/${trustProductSid}/EntityAssignments`, {
      method: 'POST',
      body: assign2.toString(),
    })
    await throttle()

    const evalForm = new URLSearchParams()
    evalForm.set('PolicySid', A2P_TRUST_PRODUCT_POLICY)
    try {
      await twilio('trusthub.twilio.com', `/v1/TrustProducts/${trustProductSid}/Evaluations`, {
        method: 'POST',
        body: evalForm.toString(),
      })
    } catch (e) {
      console.warn('Trust product evaluation:', e.message)
    }
    await throttle()

    const submitTp = new URLSearchParams()
    submitTp.set('Status', 'pending-review')
    await twilio('trusthub.twilio.com', `/v1/TrustProducts/${trustProductSid}`, {
      method: 'POST',
      body: submitTp.toString(),
    })
    await throttle()
  }

  const brandForm = new URLSearchParams()
  brandForm.set('CustomerProfileBundleSid', customerProfileSid)
  brandForm.set('A2PProfileBundleSid', trustProductSid)
  brandForm.set('BrandType', 'STANDARD')
  brandForm.set('Mock', 'false')

  let brandSid = null
  let brandNote = ''
  try {
    const brand = await twilio('messaging.twilio.com', '/v1/a2p/BrandRegistrations', {
      method: 'POST',
      body: brandForm.toString(),
    })
    brandSid = brand.sid
    console.log('Created brand:', brandSid, brand.status)
  } catch (e) {
    brandNote = String(e.message)
    console.warn('Brand submit:', brandNote)
  }

  let campaignSid = null
  let campaignNote = ''
  if (brandSid) {
    const defaultSamples = [
      'Hi [name], following up on your implant consult. Any questions about your treatment plan? Reply STOP to opt out.',
      'Hi [name], just checking in after your visit. Happy to help schedule your next step. Reply STOP to opt out.',
    ]
    const samples = (cfg.message_samples?.length >= 2 ? cfg.message_samples : defaultSamples).slice(0, 5)
    const campForm = new URLSearchParams()
    campForm.set('BrandRegistrationSid', brandSid)
    campForm.set('Description', cfg.use_case || 'Post-consult dental implant treatment plan follow-up messages.')
    campForm.set(
      'MessageFlow',
      cfg.opt_in_description ||
        'Patients provide their mobile number during the in-office consult and consent to follow-up texts about their treatment plan.',
    )
    campForm.set('UsAppToPersonUsecase', 'CUSTOMER_CARE')
    campForm.set('HasEmbeddedLinks', 'false')
    campForm.set('HasEmbeddedPhone', 'false')
    for (const s of samples) campForm.append('MessageSamples', s)
    try {
      const camp = await twilio('messaging.twilio.com', `/v1/Services/${mgSid}/Compliance/Usa2p`, {
        method: 'POST',
        body: campForm.toString(),
      })
      campaignSid = camp.sid
      console.log('Created campaign:', campaignSid, camp.campaign_status)
    } catch (e) {
      campaignNote = String(e.message)
      console.warn('Campaign submit:', campaignNote)
    }
  }

  const failure = [brandNote, campaignNote].filter(Boolean).join(' | ')
  const brandStatus = brandSid ? 'pending' : 'unregistered'
  const campaignStatus = campaignSid ? 'pending' : 'unregistered'

  const updateSql = `
UPDATE public.practices SET
  a2p_config = COALESCE(a2p_config, '{}'::jsonb) || jsonb_build_object(
    'trust_hub', jsonb_build_object(
      'customer_profile_sid', '${sqlEscape(customerProfileSid)}',
      'trust_product_sid', '${sqlEscape(trustProductSid)}'
    )
  ),
  twilio_brand_sid = ${brandSid ? `'${sqlEscape(brandSid)}'` : 'NULL'},
  twilio_campaign_sid = ${campaignSid ? `'${sqlEscape(campaignSid)}'` : 'NULL'},
  a2p_brand_status = '${brandStatus}',
  a2p_campaign_status = '${campaignStatus}',
  a2p_failure_reason = ${failure ? `'${sqlEscape(failure)}'` : 'NULL'},
  a2p_submitted_at = now(),
  sms_enabled = false
WHERE id = '${sqlEscape(PRACTICE_ID)}'
RETURNING id, name, a2p_brand_status, a2p_campaign_status, twilio_brand_sid, twilio_campaign_sid, a2p_failure_reason;
`
  const updated = dbQuery(updateSql)
  console.log('DB updated:', JSON.stringify(updated[0], null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
