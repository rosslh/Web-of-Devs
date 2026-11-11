#!/usr/bin/env node
// Run SQL against the production Web of Devs Postgres, for agents working in this project.
//
//   node .claude/skills/db/db.mjs [options] -e "<sql>"
//   node .claude/skills/db/db.mjs [options] --file <path.sql>
//   node .claude/skills/db/db.mjs [options] < script.sql
//
// Options:
//   --write      allow writes (default is a READ ONLY transaction)
//   --dry-run    with --write: run everything, print the results, then ROLL BACK
//   --csv        CSV output instead of aligned tables
//   --timeout N  statement_timeout in seconds (default 30)
//
// Every invocation is ONE transaction: it all commits or none of it does. Any error stops the
// script and rolls back. Don't write your own BEGIN/COMMIT/ROLLBACK; this wraps them for you
// (SAVEPOINT / ROLLBACK TO SAVEPOINT are fine). psql meta-commands (lines starting with a
// backslash) are refused, since \! would run a shell on the database host.
//
// Committed writes are appended to write-log.md beside this file (gitignored).
//
// Connection: the same config.json as /review-submissions (sshHost, dbContainer), reached as
// ssh -> sudo docker exec -> psql. Read-only mode is a guard against mistakes, not a security
// boundary: the connection is the database owner, which can turn read-only off.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const CONFIG_PATH = resolve(here, '../review-submissions/config.json');
const LOG_PATH = resolve(here, 'write-log.md');

function fail(message, code = 2) {
  process.stderr.write(`db.mjs: ${message}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const value = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
};

if (flag('--help') || flag('-h')) {
  process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(0);
}

const write = flag('--write');
const dryRun = flag('--dry-run');
const csv = flag('--csv');
const timeoutRaw = value('--timeout') ?? '30';
const inline = value('-e');
const file = value('--file');
if (args.length) fail(`unknown arguments: ${args.join(' ')}`);
if (dryRun && !write) fail('--dry-run only makes sense with --write');
if (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) < 1) fail('--timeout must be a positive whole number of seconds');
if (inline !== undefined && file !== undefined) fail('give -e or --file, not both');

let sql;
if (inline !== undefined) sql = inline;
else if (file !== undefined) sql = readFileSync(resolve(file), 'utf8');
else if (!process.stdin.isTTY) sql = readFileSync(0, 'utf8');
else fail('no SQL given (use -e, --file or stdin)');
if (!sql.trim()) fail('the SQL is empty');

// Guards against mistakes. They scan the text with comments stripped, so a keyword inside a
// string literal can trip them; rephrase if that happens.
const scan = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (/^\s*\\/m.test(scan)) fail('psql meta-commands (lines starting with \\) are not allowed');
const txControl = /(^|;)\s*(BEGIN|COMMIT|END|ABORT|START\s+TRANSACTION|ROLLBACK(?!\s+TO\b)|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED)\b/i;
if (txControl.test(scan)) fail('leave out BEGIN/COMMIT/ROLLBACK: each run is already one transaction');
if (!write && /\b(transaction_read_only|default_transaction_read_only|SESSION\s+CHARACTERISTICS)\b/i.test(scan)) {
  fail('read-only mode cannot be switched off from inside the SQL; pass --write instead');
}
if (/\bVACUUM\b|\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|\bCREATE\s+DATABASE\b|\bDROP\s+DATABASE\b/i.test(scan)) {
  fail('this statement cannot run inside a transaction; it needs a manual session');
}

if (!existsSync(CONFIG_PATH)) fail(`missing ${CONFIG_PATH}; copy config.example.json there and fill it in`, 1);
const { sshHost, dbContainer } = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (!sshHost || !dbContainer) fail('config.json needs sshHost and dbContainer', 1);
if (!/^[\w.-]+$/.test(dbContainer)) fail('dbContainer in config.json has unexpected characters', 1);

const script = [
  `SET statement_timeout = '${Number(timeoutRaw)}s';`,
  `SET lock_timeout = '10s';`,
  `SET idle_in_transaction_session_timeout = '${Number(timeoutRaw) + 30}s';`,
  write ? 'BEGIN;' : 'BEGIN READ ONLY;',
  sql.replace(/;?\s*$/, ';'),
  dryRun || !write ? 'ROLLBACK;' : 'COMMIT;',
  '',
].join('\n');

const psqlFlags = ['-X', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-P', 'footer=on'];
if (csv) psqlFlags.push('--csv');
const remote = `sudo docker exec -i ${dbContainer} sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" ${psqlFlags.join(' ')}'`;
const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshHost, remote], {
  input: script,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

// psql echoes the wrapper's own SET/BEGIN/COMMIT/ROLLBACK command tags; drop those lines.
const wrapperTags = new Set(['SET', 'BEGIN', 'COMMIT', 'ROLLBACK']);
const out = (r.stdout ?? '').split('\n').filter((line) => !wrapperTags.has(line.trim())).join('\n').replace(/^\n+|\s+$/g, '');
if (out) process.stdout.write(`${out}\n`);
if (r.stderr?.trim()) process.stderr.write(r.stderr);

if (r.error) fail(`could not run ssh: ${r.error.message}`, 1);
if (r.status !== 0) {
  process.stderr.write(`db.mjs: failed (exit ${r.status}); nothing was committed\n`);
  process.exit(1);
}

const mode = !write ? 'read-only, rolled back' : dryRun ? 'dry run, rolled back' : 'COMMITTED';
process.stderr.write(`db.mjs: ok (${mode})\n`);

if (write && !dryRun) {
  if (!existsSync(LOG_PATH)) appendFileSync(LOG_PATH, '# Production database writes made with db.mjs (gitignored)\n');
  appendFileSync(LOG_PATH, `\n## ${new Date().toISOString()}\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n`);
}
