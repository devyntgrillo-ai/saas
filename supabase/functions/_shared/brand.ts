// ============================================================================
// _shared/brand.ts - reseller (agency) white-label branding for outbound email.
//
// A practice links to its reseller via practices.agency_id -> agency_accounts.
// Brand columns on agency_accounts: company_name / brand_name (display name,
// either may be null), logo_url, support_email, primary_color, and the
// white_label_enabled boolean (the authoritative on/off switch, backfilled by
// migration for legacy branded resellers). A reseller is white-labeled when
// white_label_enabled is true and a display name exists.
//
// resolveBrand() is intentionally defensive: any error, missing reseller, or
// non-white-labeled reseller falls back to CASELIFT_BRAND so callers can use
// the result unconditionally.
// ============================================================================

export interface Brand {
  companyName: string;
  fromName: string;
  supportEmail: string;
  logoUrl: string | null;
  primaryColor: string;
  isWhiteLabeled: boolean;
}

export const CASELIFT_BRAND: Brand = {
  companyName: "CaseLift",
  fromName: "CaseLift",
  supportEmail: "hello@caselift.io",
  logoUrl: null,
  primaryColor: "#0EA5E9",
  isWhiteLabeled: false,
};

// Look up the reseller brand for a practice.
// `admin` is a supabase-js client (service role). `practice` may be a practice
// row (with agency_id) or a practiceId string (the practice is fetched first).
// deno-lint-ignore no-explicit-any
export async function resolveBrand(admin: any, practice: any): Promise<Brand> {
  try {
    // Accept either a practice row or a bare practiceId string.
    let agencyId: string | null = null;
    if (typeof practice === "string") {
      const { data } = await admin
        .from("practices")
        .select("agency_id")
        .eq("id", practice)
        .maybeSingle();
      agencyId = data?.agency_id ?? null;
    } else {
      agencyId = practice?.agency_id ?? null;
    }
    if (!agencyId) return CASELIFT_BRAND;

    const { data: agency } = await admin
      .from("agency_accounts")
      .select("name, company_name, brand_name, logo_url, support_email, primary_color, white_label_enabled")
      .eq("id", agencyId)
      .maybeSingle();
    if (!agency) return CASELIFT_BRAND;

    const displayName: string | null =
      agency.company_name || agency.brand_name || agency.name || null;
    const whiteLabeled = agency.white_label_enabled === true;
    if (!whiteLabeled || !displayName) return CASELIFT_BRAND;

    return {
      companyName: displayName,
      fromName: displayName,
      supportEmail: agency.support_email || CASELIFT_BRAND.supportEmail,
      logoUrl: agency.logo_url || null,
      primaryColor: agency.primary_color || CASELIFT_BRAND.primaryColor,
      isWhiteLabeled: true,
    };
  } catch (_e) {
    // Never let branding break an email send.
    return CASELIFT_BRAND;
  }
}

// HTML header: logo image when available, else a text wordmark.
export function emailHeader(brand: Brand): string {
  if (brand.logoUrl) {
    return `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.companyName)}" ` +
      `style="width:140px;max-width:140px;max-height:40px;height:auto;display:block" />`;
  }
  return `<span style="font-size:18px;font-weight:700;color:${brand.primaryColor}">${escapeHtml(brand.companyName)}</span>`;
}

// HTML footer: "<Company> · Powered by CaseLift". For CaseLift itself this
// collapses to just "CaseLift" so we never print "CaseLift · Powered by
// CaseLift".
export function emailFooter(brand: Brand): string {
  const text = brand.isWhiteLabeled
    ? `${escapeHtml(brand.companyName)} &middot; Powered by CaseLift`
    : "CaseLift";
  return `<p style="color:#9ca3af;font-size:11px;margin:18px 0 0">${text}</p>`;
}

// Email sign-off, voiced as CaseLift's team. White-labeled brands keep the reseller's
// own name; CaseLift's own emails sign off as "The CaseLift Team · caselift.io".
export function emailSignature(brand: Brand): string {
  const line = brand.isWhiteLabeled
    ? `The ${escapeHtml(brand.companyName)} Team`
    : "The CaseLift Team &middot; caselift.io";
  return `<p style="color:#6b7280;font-size:13px;margin:20px 0 0">${line}</p>`;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// Master branded HTML email template (dark navy, brand-aware).
//
// Every transactional email renders through renderBrandedEmail() so they share
// one consistent, professional look. It's brand-aware: white-labeled resellers
// keep their own logo, accent color, and company name; CaseLift's own emails get
// the "CASELIFT" wordmark with the ↑ arrow in brand blue (#0EA5E9).
// ============================================================================

export interface EmailContent {
  heading: string;
  /** Trusted HTML for the body (callers must escape any user-supplied values). */
  bodyHtml: string;
  button?: { label: string; url: string } | null;
  /** Small centered line under the CTA (e.g. "Questions? Reply to this email."). */
  subtext?: string | null;
  /** Muted note above the footer (e.g. "This invitation expires in 48 hours."). */
  footerNote?: string | null;
}

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Header lockup: reseller logo image, else the wordmark + ↑ arrow in brand color. */
function emailLockup(brand: Brand): string {
  if (brand.logoUrl) {
    return `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.companyName)}" ` +
      `style="max-height:38px;max-width:180px;height:auto;display:inline-block" />`;
  }
  return `<span style="font-size:22px;font-weight:700;letter-spacing:0.06em;color:#ffffff">` +
    `<span style="color:${brand.primaryColor}">&uarr;</span>${escapeHtml(brand.companyName.toUpperCase())}</span>`;
}

/** Stat rows for digest emails: label left, bold value right, subtle divider between. */
export function statRows(rows: Array<{ label: string; value: string }>): string {
  const cells = rows.map((r, i) =>
    `<tr>
       <td style="padding:14px 0;color:#94a3b8;font-size:15px;${i ? "border-top:1px solid #2a3142" : ""}">${escapeHtml(r.label)}</td>
       <td style="padding:14px 0;color:#ffffff;font-size:18px;font-weight:700;text-align:right;${i ? "border-top:1px solid #2a3142" : ""}">${escapeHtml(r.value)}</td>
     </tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0">${cells}</table>`;
}

// Grid of metric tiles (2 per row): big number + label, optional accent color.
export function statTiles(tiles: Array<{ label: string; value: string; accent?: string }>): string {
  const cell = (t?: { label: string; value: string; accent?: string }) =>
    t
      ? `<td width="50%" valign="top" style="padding:0">
           <div style="background:#0f1117;border:1px solid #2a3142;border-radius:10px;padding:18px 20px">
             <div style="color:${t.accent || "#ffffff"};font-size:28px;font-weight:800;letter-spacing:-0.02em;line-height:1">${escapeHtml(t.value)}</div>
             <div style="color:#94a3b8;font-size:13px;margin-top:6px">${escapeHtml(t.label)}</div>
           </div>
         </td>`
      : `<td width="50%" style="padding:0"></td>`;
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(`<tr>${cell(tiles[i])}${cell(tiles[i + 1])}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="10" style="margin:18px 0 0;border-collapse:separate">${rows.join("")}</table>`;
}

// Green "win" highlight callout for a notable positive result.
export function winBox(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr>
    <td style="background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.4);border-radius:10px;padding:16px 18px;color:#a7f3d0;font-size:15px;line-height:1.5">${innerHtml}</td>
  </tr></table>`;
}

export function renderBrandedEmail(brand: Brand, c: EmailContent): string {
  const accent = brand.primaryColor || "#0EA5E9";
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:28px auto 0">
         <tr><td align="center" style="border-radius:8px;background:${accent}">
           <a href="${c.button.url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;font-family:${FONT_STACK}">${escapeHtml(c.button.label)}</a>
         </td></tr>
       </table>`
    : "";
  const subtext = c.subtext
    ? `<p style="color:#64748b;font-size:13px;line-height:1.6;text-align:center;margin:18px 0 0">${c.subtext}</p>`
    : "";
  const footerNote = c.footerNote
    ? `<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:24px 0 0">${c.footerNote}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(brand.companyName)}</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:${FONT_STACK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#1a1f2e;border-radius:12px;border-top:3px solid ${accent}">
        <tr><td style="padding:40px">
          <div style="text-align:center;margin:0 0 30px">${emailLockup(brand)}</div>
          <h1 style="color:#ffffff;font-size:22px;font-weight:600;line-height:1.3;margin:0 0 16px">${escapeHtml(c.heading)}</h1>
          <div style="color:#94a3b8;font-size:15px;line-height:1.6">${c.bodyHtml}</div>
          ${button}
          ${subtext}
          ${footerNote}
          <div style="border-top:1px solid #2a3142;margin:32px 0 0;padding-top:20px">
            <p style="color:#475569;font-size:12px;line-height:1.6;margin:0">You're receiving this because you have a ${escapeHtml(brand.companyName)} account.</p>
            <p style="color:#475569;font-size:12px;line-height:1.6;margin:6px 0 0">&copy; 2026 ${escapeHtml(brand.companyName)}. All rights reserved.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
