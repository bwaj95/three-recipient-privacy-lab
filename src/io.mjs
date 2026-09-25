import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export async function withLock(work) {
  fs.mkdirSync('.lab', { recursive: true, mode: 0o700 });
  const lock = '.lab/runner.lock';
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another runner or stale .lab/runner.lock exists. Check processes before removing it.'); throw e; }
  try { fs.writeFileSync(fd, String(process.pid)); return await work(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}
