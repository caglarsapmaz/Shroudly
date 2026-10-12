'use strict';

/*
 * UpdateRelay — lets Discord's updater through on networks that read the
 * server certificate.
 *
 * Discord's native updater uses macOS Secure Transport, which speaks at most
 * TLS 1.2. In TLS 1.2 the server's certificate travels in the clear, so DPI
 * can see "discord.com" in the server's reply and cut the connection after
 * ServerHello, whatever we do to the ClientHello. TLS 1.3 encrypts the
 * certificate, so the same request made with TLS 1.3 gets through.
 *
 * Discord reads its update server from settings.json (NEW_UPDATE_ENDPOINT).
 * Pointed at this relay, the updater talks plain HTTP to 127.0.0.1 and the
 * relay repeats each request to the real server over TLS 1.3 through the
 * engine's SOCKS5 port, so it gets the usual desync and encrypted DNS. Package
 * URLs inside the manifests are rewritten to come back here too. Nothing is
 * altered otherwise: the updater checks every package against the SHA-256 in
 * the manifest, so a tampered byte would be rejected.
 *
 * Only loopback can reach it, and it only forwards to Discord's own domains.
 */

const http = require('http');
const net = require('net');
const tls = require('tls');

const RELAY_PORT = 10809;
const UPSTREAM_DEFAULT = 'updates.discord.com';
const ALLOWED = /(^|\.)(discord\.com|discordapp\.net|discordapp\.com)$/i;
// /__h/<host>/<path> — a rewritten package URL.
const HOST_PREFIX = '/__h/';

function socksConnect(socksPort, host, port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port: socksPort });
    const fail = (e) => { s.destroy(); reject(e); };
    s.setTimeout(timeoutMs, () => fail(new Error('SOCKS timeout')));
    s.once('error', fail);
    let stage = 0;
    let buf = Buffer.alloc(0);
    s.once('connect', () => s.write(Buffer.from([5, 1, 0])));
    s.on('data', function onData(d) {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[0] !== 5 || buf[1] !== 0) return fail(new Error('SOCKS auth refused'));
        buf = buf.subarray(2);
        stage = 1;
        const h = Buffer.from(host);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
      }
      if (stage === 1 && buf.length >= 10) {
        if (buf[1] !== 0) return fail(new Error(`SOCKS connect failed (${buf[1]})`));
        s.removeListener('data', onData);
        s.setTimeout(0);
        s.removeListener('error', fail);
        resolve(s);
      }
    });
  });
}

/* Absolute https URLs on Discord's domains -> this relay. */
function rewriteUrls(text, base) {
  return text.replace(/https:\/\/([a-z0-9.-]+)\//gi, (m, host) =>
    ALLOWED.test(host) ? `${base}${HOST_PREFIX}${host}/` : m);
}

class UpdateRelay {
  constructor(log, getSocksPort) {
    this.log = log || (() => {});
    this.getSocksPort = getSocksPort;
    this.server = null;
    this.port = RELAY_PORT;
  }

  start(port = RELAY_PORT) {
    if (this.server) return Promise.resolve(this.port);
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._handle(req, res));
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        srv.removeListener('error', reject);
        this.server = srv;
        this.port = port;
        resolve(port);
      });
    });
  }

  stop() {
    if (this.server) { try { this.server.close(); } catch {} this.server = null; }
  }

  async _handle(req, res) {
    let host = UPSTREAM_DEFAULT;
    let path = req.url || '/';
    if (path.startsWith(HOST_PREFIX)) {
      const rest = path.slice(HOST_PREFIX.length);
      const i = rest.indexOf('/');
      host = i < 0 ? rest : rest.slice(0, i);
      path = i < 0 ? '/' : rest.slice(i);
    }
    if (!ALLOWED.test(host) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(403).end();
      return;
    }

    let sock;
    try {
      const raw = await socksConnect(this.getSocksPort(), host, 443);
      sock = tls.connect({ socket: raw, servername: host, minVersion: 'TLSv1.3', ALPNProtocols: ['http/1.1'] });
    } catch (e) {
      this.log('warning', `Update relay: ${host} unreachable (${e.message})`);
      res.writeHead(502).end();
      return;
    }

    const headers = { ...req.headers, host };
    delete headers.connection;
    delete headers['proxy-connection'];
    // The manifest is rewritten, so ask for it uncompressed.
    const isManifest = !path.startsWith('/distro/') && /manifest/i.test(path);
    if (isManifest) delete headers['accept-encoding'];

    const up = http.request({ createConnection: () => sock, method: req.method, path, headers }, (ur) => {
      if (isManifest && ur.statusCode === 200) {
        const chunks = [];
        ur.on('data', (c) => chunks.push(c));
        ur.on('end', () => {
          const base = `http://127.0.0.1:${this.port}`;
          const body = Buffer.from(rewriteUrls(Buffer.concat(chunks).toString('utf8'), base));
          const h = { ...ur.headers, 'content-length': String(body.length) };
          delete h['content-encoding'];
          delete h['transfer-encoding'];
          res.writeHead(ur.statusCode, h);
          res.end(body);
        });
        ur.on('error', () => res.destroy());
        return;
      }
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', (e) => {
      this.log('warning', `Update relay: ${host}${path.split('?')[0]} failed (${e.message})`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on('aborted', () => up.destroy());
    req.pipe(up);
  }
}

module.exports = UpdateRelay;
module.exports.RELAY_PORT = RELAY_PORT;
module.exports.rewriteUrls = rewriteUrls;
