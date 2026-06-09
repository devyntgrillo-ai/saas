// link-preview - fetch a URL and return Open Graph / basic metadata for an
// unfurl card. Best-effort: returns { ok:false } on any failure so the client
// just renders nothing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function meta(html: string, ...keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`,
      "i",
    );
    const m = html.match(re);
    if (m) return (m[1] || m[2] || "").trim();
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);
  try {
    const { url } = await req.json().catch(() => ({}));
    if (!url || !/^https?:\/\//i.test(url)) return json({ ok: false });

    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CaseLiftBot/1.0)", accept: "text/html" },
      signal: AbortSignal.timeout(6000),
    });
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !ctype.includes("text/html")) return json({ ok: false });

    // Read at most ~256KB of the document head.
    const buf = new Uint8Array(await res.arrayBuffer());
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 262144));

    const title = meta(html, "og:title", "twitter:title") || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "").trim();
    const description = meta(html, "og:description", "twitter:description", "description");
    let image = meta(html, "og:image", "twitter:image");
    const siteName = meta(html, "og:site_name") || new URL(url).hostname.replace(/^www\./, "");
    if (image && image.startsWith("/")) {
      try { image = new URL(image, url).href; } catch { /* ignore */ }
    }
    if (!title && !description && !image) return json({ ok: false });
    return json({ ok: true, url, title: title || siteName, description: description || null, image: image || null, siteName });
  } catch {
    return json({ ok: false });
  }
});
