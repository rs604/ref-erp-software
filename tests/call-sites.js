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

/* The text of the second argument to a call, given the index of its "(". */
function secondArg(src, openParenIdx) {
  const parts = splitTopLevel(src, openParenIdx);
  return parts.length > 1 ? parts[1].trim() : '';
}

/* The arguments of a call, as text, given the index of its "(". */
function splitTopLevel(src, openParenIdx) {
  let depth = 0, start = openParenIdx + 1;
  const parts = [];
  for (let i = openParenIdx; i < src.length; i++) {
    const c = src[i];
    if ('{[('.includes(c)) { depth++; continue; }
    if ('}])'.includes(c)) {
      depth--;
      if (depth === 0) { parts.push(src.slice(start, i)); return parts; }
      continue;
    }
    if (c === ',' && depth === 1) { parts.push(src.slice(start, i)); start = i + 1; }
  }
  return parts;
}

/* What keys does this expression pass? null means "cannot be read from here",
   which is not the same as "no arguments". Three shapes are understood, and
   only three: an object literal, Object.assign of things that are themselves
   understood, and a name declared once in this file as an object literal.
   Anything else stays opaque and is reported as such rather than guessed at. */
function keysOfExpression(src, expr) {
  const e = expr.trim();
  if (e === '') return [];
  if (e[0] === '{') return argsOfCall(e, 0);
  const asn = /^Object\s*\.\s*assign\s*\(/.exec(e);
  if (asn) {
    const parts = splitTopLevel(e, asn[0].length - 1);
    const keys = [];
    for (const part of parts) {
      const k = keysOfExpression(src, part);
      if (k === null) return null;
      for (const one of k) if (!keys.includes(one)) keys.push(one);
    }
    return keys;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(e)) {
    // Declared exactly once, as an object literal. Twice and we cannot know
    // which one this call meant, so we say we cannot know.
    const decl = new RegExp('\\b(?:var|let|const)\\s+' + e + '\\s*=\\s*\\{', 'g');
    const at = [];
    let d;
    while ((d = decl.exec(src))) at.push(d.index + d[0].length - 1);
    if (at.length === 1) return argsOfCall(src, at[0]);
    return null;
  }
  return null;
}

function rpcCallSites(root) {
  const out = [];
  for (const file of sourceFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    // The second argument is an object literal, nothing at all, a name that
    // holds one, Object.assign of those -- or something this cannot read.
    // That last case is NOT "no arguments": it is arguments that cannot be
    // checked from here, and saying so is the difference between a useful
    // check and a check that invents findings.
    const re = /\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]\s*(,)?\s*([{A-Za-z_)])?/g;
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      const where = path.relative(root, file) + ':' + line;
      if (!m[2] || m[3] === ')') { out.push({ where, fn: m[1], args: [] }); continue; }
      const open = src.indexOf('(', m.index);
      const keys = keysOfExpression(src, secondArg(src, open));
      if (keys === null) out.push({ where, fn: m[1], args: null, opaque: true });
      else out.push({ where, fn: m[1], args: keys });
    }
  }
  return out;
}

module.exports = { sourceFiles, argsOfCall, keysOfExpression, rpcCallSites };
