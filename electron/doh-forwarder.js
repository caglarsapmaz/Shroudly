'use strict';

/*
 * Local DNS-over-HTTPS forwarder.
 *
 * Listens for ordinary DNS queries on 127.0.0.1:<port> (UDP) and answers them
 * over real RFC 8484 DoH. The engine's resolver (core/src/doh.c) sends its
 * queries here when the app passes --doh-port, so DNS resolution is encrypted
 * and cannot be read or injected on the wire.
 *
 * Each upstream is reached BY IP with TLS but no SNI, so the DoH connection
 * itself can't be blocked by SNI inspection. Validation still succeeds because
 * the certificates for these resolvers list their own IPs, which we check
 * explicitly against the presented certificate (tls does not verify identity
 * when servername is empty).
 *
 * Nothing is logged or stored: a query comes in, a DoH request goes out, the
 * answer goes back.
 */

const dgram = require('dgram');
const https = require('https');
const tls = require('tls');

// Upstreams by IP, with the cert names we accept for that IP. Tried in order;
// a slow or blocked one falls through to the next.
const UPSTREAMS = [
  { ip: '1.1.1.1', names: ['cloudflare-dns.com', '1.1.1.1', 'one.one.one.one'] },
  { ip: '9.9.9.9', names: ['dns.quad9.net', '9.9.9.9'] },
  { ip: '8.8.8.8', names: ['dns.google', '8.8.8.8'] },
];
const UPSTREAM_TIMEOUT_MS = 4000;

function certCoversIp(cert, ip) {
  // subjectaltname like "DNS:cloudflare-dns.com, IP Address:1.1.1.1"
  const san = cert && cert.subjectaltname;
  if (!san) return false;
  return san.split(',').map((s) => s.trim()).some((e) => e === `IP Address:${ip}`);
}

function queryUpstream(up, dnsMsg) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: up.ip,
      servername: '', // no SNI
      port: 443,
      path: '/dns-query',
      method: 'POST',
      headers: {
        'content-type': 'application/dns-message',
        accept: 'application/dns-message',
        'content-length': dnsMsg.length,
      },
      // Verify against the IP (SAN) ourselves, since without a servername the
      // default identity check has no hostname to match.
      checkServerIdentity: (_host, cert) => {
        if (certCoversIp(cert, up.ip)) return undefined;
        // Some resolvers put only their hostname in the cert, not the IP.
        try { return tls.checkServerIdentity(up.names[0], cert); }
        catch (e) { return e; }
      },
      timeout: UPSTREAM_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(dnsMsg);
  });
}

async function resolveDoH(dnsMsg) {
  let lastErr;
  for (const up of UPSTREAMS) {
    try { return await queryUpstream(up, dnsMsg); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all upstreams failed');
}

class DohForwarder {
  constructor(log) {
    this.log = log || (() => {});
    this.sock = null;
    this.port = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      sock.on('error', (e) => { this.log('warning', `DoH forwarder: ${e.message}`); try { sock.close(); } catch {} });
      sock.on('message', (msg, rinfo) => {
        if (msg.length < 12 || msg.length > 4096) return; // not a sane DNS query
        resolveDoH(msg)
          .then((answer) => { try { sock.send(answer, rinfo.port, rinfo.address); } catch {} })
          .catch(() => { /* drop: the engine falls back to public UDP resolvers */ });
      });
      sock.bind(0, '127.0.0.1', () => {
        this.sock = sock;
        this.port = sock.address().port;
        resolve(this.port);
      });
      sock.once('error', reject);
    });
  }

  stop() { if (this.sock) { try { this.sock.close(); } catch {} this.sock = null; } }
}

module.exports = DohForwarder;
