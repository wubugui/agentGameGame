/**
 * Static sanity pass over the source tree, run before the browser harness so
 * obvious breakage surfaces in a second instead of a two-minute page boot.
 *
 * Checks:
 *  1. every file parses (node --check)
 *  2. every relative import resolves to a real file
 *  3. every named import exists as a named export in the target module
 *  4. nothing reaches the network at runtime (fetch/XHR/CDN URLs)
 */
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = await walk(SRC);
const problems = [];
const exportsOf = new Map();

const NAMED_EXPORT = /^\s*export\s+(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;
const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+|([\w$]+))?\s*(?:from\s*)?['"]([^'"]+)['"]/g;

// --- 1. parse + collect exports -------------------------------------------
for (const f of files) {
  const rel = relative(ROOT, f);
  try {
    await run('node', ['--check', f]);
  } catch (e) {
    problems.push(`SYNTAX  ${rel}\n        ${(e.stderr || '').split('\n').slice(0, 4).join('\n        ')}`);
    continue;
  }
  const src = await readFile(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(NAMED_EXPORT)) names.add(m[1]);
  for (const m of src.matchAll(EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      names.add((t.split(/\s+as\s+/).pop() || t).trim());
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  exportsOf.set(f, names);

  if (/\bfetch\s*\(|XMLHttpRequest|https?:\/\/(?!localhost|127\.)/.test(src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    problems.push(`NETWORK ${rel}  reaches the network or embeds an external URL`);
  }
}

// --- 2 + 3. resolve imports and verify named bindings ----------------------
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = await readFile(f, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[4];
    if (!spec.startsWith('.')) continue;               // bare specifiers go through the import map
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) { problems.push(`MISSING ${rel}  -> ${spec}`); continue; }
    const named = (m[2] || '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const have = exportsOf.get(target);
    if (!have) continue;                               // target failed to parse; already reported
    for (const n of named) {
      if (!have.has(n)) problems.push(`EXPORT  ${rel}  imports { ${n} } from ${spec}, which does not export it`);
    }
    if ((m[1] || m[3]) && !have.has('default')) {
      problems.push(`EXPORT  ${rel}  imports a default from ${spec}, which has no default export`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ ${files.length} modules parse, imports resolve, no network access`);
