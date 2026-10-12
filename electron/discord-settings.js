'use strict';

/*
 * Points Discord's updater at the update relay (see update-relay.js) by
 * setting NEW_UPDATE_ENDPOINT in Discord's own settings.json, and takes it
 * out again. macOS only: that is where the updater is stuck on TLS 1.2.
 *
 * Discord keeps settings.json in memory and writes it back when it quits, so
 * an edit made while it runs would be lost: the caller quits Discord first
 * and opens it again afterwards. macOS may refuse access to another app's
 * data folder (EPERM) until the user allows it; callers can then retry on a
 * path the user picked in an open dialog, which macOS treats as consent.
 *
 * File access is async on purpose: a TCC check can block until the user
 * answers its prompt, and it must not freeze the main process meanwhile.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const KEY = 'NEW_UPDATE_ENDPOINT';

const VARIANTS = [
  { dir: 'discord', app: 'Discord' },
  { dir: 'discordptb', app: 'Discord PTB' },
  { dir: 'discordcanary', app: 'Discord Canary' },
];

function endpointUrl(port) { return `http://127.0.0.1:${port}/`; }

function appPath(v) {
  for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const p = path.join(base, `${v.app}.app`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function settingsFile(v) {
  return path.join(os.homedir(), 'Library', 'Application Support', v.dir, 'settings.json');
}

/* Discord builds that are installed on this Mac. */
function installed() {
  if (process.platform !== 'darwin') return [];
  return VARIANTS.filter((v) => appPath(v));
}

/* Set (url) or remove (null) our key. Removing only touches a value we set,
 * so an endpoint the user configured themselves is left alone. Returns true
 * when the file changed. Throws on access errors (err.code EPERM / EACCES). */
async function patchFile(file, url) {
  let text = '';
  try { text = await fs.promises.readFile(file, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let obj = {};
  if (text.trim()) {
    try { obj = JSON.parse(text); }
    catch { throw Object.assign(new Error(`${file} is not valid JSON`), { code: 'EBADJSON' }); }
  }
  if (url) {
    if (obj[KEY] === url) return false;
    obj = { [KEY]: url, ...obj, [KEY]: url };
  } else {
    if (!(KEY in obj) || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(String(obj[KEY]))) return false;
    delete obj[KEY];
  }
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return true;
}

function pids(v) {
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-x', v.app], (err, out) => {
      resolve(err ? [] : String(out).split('\n').map((s) => Number(s.trim())).filter(Boolean));
    });
  });
}

/* SIGTERM is Electron's normal quit, so Discord saves its settings first. */
async function quit(v, timeoutMs = 10000) {
  for (const pid of await pids(v)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await pids(v)).length === 0) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function launch(v) {
  return new Promise((resolve) => execFile('/usr/bin/open', ['-a', appPath(v) || v.app], () => resolve()));
}

module.exports = { KEY, endpointUrl, installed, settingsFile, patchFile, pids, quit, launch };
