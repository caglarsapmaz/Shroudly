#!/usr/bin/env node
/*
 * After the Windows installers are code-signed (which changes their bytes),
 * electron-updater's latest.yml still holds the pre-signing SHA-512 and size.
 * This recomputes them from the signed files in dist/ so auto-update keeps
 * verifying correctly. Run after signing, before publishing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dist = path.join(__dirname, '..', 'dist');
const ymlPath = path.join(dist, 'latest.yml');
if (!fs.existsSync(ymlPath)) { console.log('[win-latest] no latest.yml; nothing to do'); process.exit(0); }

const sha512 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');

let yml = fs.readFileSync(ymlPath, 'utf8');

// Each "  - url: <file>\n    sha512: <...>\n    size: <...>" block.
yml = yml.replace(/( {2}- url: (\S+)\n {4}sha512: )\S+(\n {4}size: )\d+/g, (m, p1, file, p3) => {
  const f = path.join(dist, file);
  if (!fs.existsSync(f)) return m;
  const stat = fs.statSync(f);
  console.log(`[win-latest] ${file}: size ${stat.size}`);
  return `${p1}${sha512(f)}${p3}${stat.size}`;
});

// Top-level path/sha512 point at the first (x64) installer.
const topFile = (yml.match(/^path: (\S+)/m) || [])[1];
if (topFile && fs.existsSync(path.join(dist, topFile))) {
  const f = path.join(dist, topFile);
  yml = yml.replace(/^sha512: \S+/m, `sha512: ${sha512(f)}`);
}

fs.writeFileSync(ymlPath, yml);
console.log('[win-latest] latest.yml recomputed from signed files');
