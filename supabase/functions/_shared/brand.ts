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
  supportEmail: "support@caselift.io",
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

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
