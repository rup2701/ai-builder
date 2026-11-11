import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching a page for someone who typed the address. The address is not trusted: it must not reach the builder's own network,
 * a cloud metadata address, or anything private. Every redirect is checked again, and the body is read with a size cap.
 * What this cannot do: pin the address it resolved, so a hostile DNS server that answers differently the second time could still slip through.
 * The importer therefore runs only for signed-in owners, rate limited, and never returns raw page bytes.
 */

export class ImportError extends Error {
  name = "ImportError";
}

export const MAX_BYTES = 1_500_000;
export const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** True for any address a stranger must never make us connect to. */
export function isBlockedAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (isIP(v) === 6) {
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b");
  }
  return true; // not an address we understand
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Parses what the owner typed and refuses anything that is not an ordinary public web address. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  const text = raw.trim();
  if (!text || text.length > 500) throw new ImportError("Please paste the address of your website.");
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ImportError("That does not look like a web address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ImportError("Only web addresses (http or https) can be read.");
  if (u.username || u.password) throw new ImportError("Addresses with a login in them cannot be read.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new ImportError("That address uses an unusual port, so I cannot read it.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new ImportError("Please use the website's name, not a number address.");
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") throw new ImportError("That address is not a public website.");
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    throw new ImportError("I could not find that website. Check the address.");
  }
  if (!ips.length || ips.some(isBlockedAddress)) throw new ImportError("That address is not a public website.");
  u.hash = "";
  return u;
}

export type FetchDeps = { fetchImpl?: typeof fetch; resolve?: Resolver };

/** Reads at most maxBytes of the body, then stops. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/** Fetches one HTML page safely. Returns the final address and the page source. */
export async function safeFetchHtml(raw: string, deps: FetchDeps = {}): Promise<{ url: string; html: string }> {
  const doFetch = deps.fetchImpl ?? fetch;
  let current = await assertPublicUrl(raw, deps.resolve);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; AppnomicsImport/1.0; +https://appnomics.dev)", accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      throw new ImportError("I could not open that website. It may be down, or it may block visitors like me.");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === MAX_REDIRECTS) throw new ImportError("That website redirects too many times.");
      current = await assertPublicUrl(new URL(loc, current).toString(), deps.resolve);
      continue;
    }
    if (!res.ok) throw new ImportError(`That website answered with an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) throw new ImportError("That address is not a web page I can read.");
    return { url: current.toString(), html: await readCapped(res, MAX_BYTES) };
  }
  throw new ImportError("That website redirects too many times.");
}

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Fetches one picture from a public address, with the same address checks as a page. Returns the bytes, or throws ImportError. */
export async function safeFetchImage(raw: string, deps: FetchDeps = {}): Promise<{ url: string; bytes: Buffer }> {
  const doFetch = deps.fetchImpl ?? fetch;
  let current = await assertPublicUrl(raw, deps.resolve);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; AppnomicsImport/1.0; +https://appnomics.dev)", accept: "image/jpeg,image/png,image/webp" },
      });
    } catch {
      throw new ImportError("I could not download that picture.");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === MAX_REDIRECTS) throw new ImportError("That picture redirects too many times.");
      current = await assertPublicUrl(new URL(loc, current).toString(), deps.resolve);
      continue;
    }
    if (!res.ok) throw new ImportError(`That picture answered with an error (${res.status}).`);
    if (!/^image\/(jpe?g|png|webp)/i.test(res.headers.get("content-type") ?? "")) throw new ImportError("That address is not a JPG, PNG or WebP picture.");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new ImportError("That picture is too large.");
    const reader = res.body?.getReader();
    if (!reader) throw new ImportError("That picture was empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) { await reader.cancel().catch(() => {}); throw new ImportError("That picture is too large."); }
      chunks.push(value);
    }
    return { url: current.toString(), bytes: Buffer.concat(chunks) };
  }
  throw new ImportError("That picture redirects too many times.");
}
