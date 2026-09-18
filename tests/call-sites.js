/* ============================================================
   Every database call in the repo, found once.

   Both checks use this: the offline one against the recorded signatures,
   and the live one against the project itself. Two copies of this parser
   would be the same drift this whole folder exists to prevent.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['.git', 'node_modules', 'tokyo-backup', 'tests']);

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(html|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/* The top-level keys of the object literal a call passes. */
function argsOfCall(src, openBraceIdx) {
  let depth = 0, end = openBraceIdx;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(openBraceIdx + 1, end);
  const keys = [];
  let d = 0, expectKey = true;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('{[('.includes(c)) { d++; continue; }
    if ('}])'.includes(c)) { d--; continue; }
    if (d !== 0) continue;
    if (c === ',') { expectKey = true; continue; }
    if (/\s/.test(c)) continue;
    // Step over comments. A comment between a comma and the next key used to
    // eat that key, so an argument that WAS passed was reported missing.
    if (c === '/' && body[i + 1] === '/') { i = body.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && body[i + 1] === '*') { i = body.indexOf('*/', i) + 1; if (i < 1) break; continue; }
    if (expectKey) {
      // A key sits at the START of an entry and nowhere else. Without that,
      // the middle of a ternary reads as a key.
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(body.slice(i));
      if (m) keys.push(m[1]);
      expectKey = false;
    }
  }
  return keys;
}

function rpcCallSites(root) {
  const out = [];
  for (const file of sourceFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    // The second argument is either an object literal, nothing at all, or
    // something this cannot read -- a variable, or Object.assign(...). That
    // last case is NOT "no arguments": it is arguments that cannot be checked
    // from here, and saying so is the difference between a useful check and a
    // check that invents findings.
    const re = /\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?\s*([{A-Za-z_)])?/g;
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      const where = path.relative(root, file) + ':' + line;
      if (!m[2] || m[3] === ')') { out.push({ where, fn: m[1], args: [] }); continue; }
      if (m[3] === '{') {
        const brace = src.indexOf('{', m.index + m[0].length - 1);
        out.push({ where, fn: m[1], args: argsOfCall(src, brace) });
      } else {
        out.push({ where, fn: m[1], args: null, opaque: true });
      }
    }
  }
  return out;
}

module.exports = { sourceFiles, argsOfCall, rpcCallSites };
