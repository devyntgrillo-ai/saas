/** Resolve a human TC first name for message sign-offs. */
export function tcFirstNameFrom(raw: string | null | undefined): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const local = s.split("@")[0]?.replace(/[._+-]/g, " ").trim();
    if (!local) return null;
    return local.split(/\s+/)[0]!.charAt(0).toUpperCase() + local.split(/\s+/)[0]!.slice(1).toLowerCase();
  }
  const first = s.split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Replace TC / practice placeholders in outbound copy. */
export function applyTcSignoff(
  text: string | null | undefined,
  tcFirst: string | null,
  practiceName: string | null,
): string | null {
  if (!text) return text ?? null;
  let out = text;
  const tc = tcFirst || "your care team";
  const practice = practiceName || "our office";
  const patterns = [
    /\[TC\s*First\s*Name\]/gi,
    /\[TC\s*Name\]/gi,
    /\[TC\]/gi,
    /\[Your\s*Name\]/gi,
    /\[Coordinator\s*Name\]/gi,
  ];
  for (const p of patterns) out = out.replace(p, tc);
  out = out.replace(/\[Practice\s*Name\]/gi, practice);
  return out;
}

// deno-lint-ignore no-explicit-any
export async function resolveTcFirstName(
  admin: any,
  consult: { tc_name?: string | null; outcome_set_by?: string | null },
): Promise<string | null> {
  const fromConsult = tcFirstNameFrom(consult.tc_name);
  if (fromConsult && !String(consult.tc_name || "").includes("@")) return fromConsult;

  if (consult.outcome_set_by) {
    const { data: user } = await admin
      .from("users")
      .select("display_name, email")
      .eq("id", consult.outcome_set_by)
      .maybeSingle();
    const fromUser = tcFirstNameFrom(user?.display_name) || tcFirstNameFrom(user?.email);
    if (fromUser) return fromUser;
  }

  return fromConsult;
}
