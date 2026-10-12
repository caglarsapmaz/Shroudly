/*
 * Shroudly live user counter (Cloudflare Worker + Durable Object).
 * Deployed at https://shroudly.codeshare.me.
 *
 * Anonymous by design: each running app picks a random id when it starts
 * (not stored on the device) and pings every `interval` seconds. An id that
 * stops pinging expires; quitting removes it at once. Only the ids and their
 * last-seen times live here, in memory: no IPs, headers or anything else about
 * the user is read or stored.
 *
 *   POST /v1/ping   {"id": "<random>"}  -> {"online": n, "interval": s}
 *   POST /v1/leave  {"id": "<random>"}  -> {"online": n, "interval": s}
 *   GET  /v1/online                     -> {"online": n, "interval": s}
 *
 * The server sets the ping interval and widens it as the count grows, keeping
 * the request volume within Workers limits.
 */

const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

/* Cloudflare evicts an idle Durable Object from memory between requests, so
 * the id list is also kept in its storage and loaded back when the object
 * wakes up. Joins and leaves (one per app launch / quit) are saved at once;
 * routine pings only refresh timestamps and are saved in one batched write at
 * most every SAVE_EVERY_MS, so writes stay low however many users ping. */
const SAVE_EVERY_MS = 30000;

export class Presence {
  constructor(state) {
    this.state = state;
    this.seen = new Map(); // id -> last ping (ms)
    this.dirty = false;
    state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('seen');
      if (saved) this.seen = new Map(Object.entries(saved));
    });
  }

  interval() {
    const n = this.seen.size;
    return n < 500 ? 60 : n < 3000 ? 180 : 300;
  }

  prune(now) {
    // Expire ids that missed more than two pings (interval as seen by clients).
    const ttl = this.interval() * 2.5 * 1000;
    for (const [id, t] of this.seen) if (now - t > ttl) { this.seen.delete(id); this.dirty = true; }
  }

  async saveNow() {
    this.dirty = false;
    await this.state.storage.put('seen', Object.fromEntries(this.seen));
  }

  async scheduleSave() {
    this.dirty = true;
    if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + SAVE_EVERY_MS);
  }

  async alarm() {
    this.prune(Date.now());
    if (this.dirty) await this.saveNow();
    // Keep saving while anyone is online, so expiries are persisted too.
    if (this.seen.size) await this.state.storage.setAlarm(Date.now() + SAVE_EVERY_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (request.method === 'POST') {
      let id = '';
      try { id = String((await request.json()).id || ''); } catch {}
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
      const joined = !this.seen.has(id);
      if (url.pathname === '/v1/leave') { if (!joined) { this.seen.delete(id); await this.saveNow(); } }
      else {
        this.seen.set(id, now);
        if (joined) await this.saveNow(); else await this.scheduleSave();
      }
    }
    this.prune(now);
    return json({ online: this.seen.size, interval: this.interval() });
  }
}

/* ── always-latest download redirects ─────────────────────────────────────
 * /dl                -> the latest release page
 * /dl/<key>          -> 302 to that platform's installer in the latest release
 * The latest-release lookup is cached ~10 min so GitHub's unauthenticated API
 * limit is never a problem. */
const DL_PATTERNS = {
  'windows-x64':  /Windows-x64-Setup\.exe$/i,
  'windows-arm64':/Windows-arm64-Setup\.exe$/i,
  'macos-arm64':  /macOS-arm64\.dmg$/i,
  'macos-x64':    /macOS-x64\.dmg$/i,
  'macos-arm64-zip': /macOS-arm64\.zip$/i,
  'macos-x64-zip': /macOS-x64\.zip$/i,
  'linux-x64':    /Linux-x86_64\.AppImage$/i,
  'linux-arm64':  /Linux-arm64\.AppImage$/i,
  'linux-deb':    /Linux-amd64\.deb$/i,
};
const RELEASES_LATEST = 'https://github.com/umutxyp/Shroudly/releases/latest';

async function latestRelease(ctx) {
  const cache = caches.default;
  const cacheKey = new Request('https://shroudly.codeshare.me/__latest_release');
  let res = await cache.match(cacheKey);
  if (!res) {
    const gh = await fetch('https://api.github.com/repos/umutxyp/Shroudly/releases/latest', {
      headers: { 'user-agent': 'shroudly-dl', accept: 'application/vnd.github+json' },
    });
    if (!gh.ok) return null;
    res = new Response(await gh.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  try { return JSON.parse(await res.text()); } catch { return null; }
}

async function handleDownload(pathname, ctx) {
  const key = pathname.replace(/^\/dl\/?/, '');
  if (!key) return Response.redirect(RELEASES_LATEST, 302);
  const pat = DL_PATTERNS[key];
  if (!pat) return new Response('unknown download key', { status: 404 });
  const rel = await latestRelease(ctx);
  const asset = rel && (rel.assets || []).find((a) => pat.test(a.name));
  if (!asset) return Response.redirect(RELEASES_LATEST, 302);
  return Response.redirect(asset.browser_download_url, 302);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && (pathname === '/dl' || pathname.startsWith('/dl/'))) {
      return handleDownload(pathname, ctx);
    }
    const route = `${request.method} ${pathname}`;
    if (route === 'POST /v1/ping' || route === 'POST /v1/leave' || route === 'GET /v1/online') {
      const stub = env.PRESENCE.get(env.PRESENCE.idFromName('global'));
      return stub.fetch(request);
    }
    return json({ error: 'not found' }, 404);
  },
};
