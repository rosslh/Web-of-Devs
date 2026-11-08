#!/usr/bin/env node
// Helper for the /review-submissions skill. It reads the moderation queue from the production
// database, measures a submitted site, and writes review decisions. Two rules shape it:
//
// - Every write is guarded on what the decision was made against (the entry's status and the
//   exact URL that was checked) and must change exactly one row, or the command exits 3.
// - Text that submitters or reporters control (page text, titles, links, console messages,
//   report reasons, display names) never goes to stdout. It goes to files under --out that only
//   the read-only site-judge subagent reads, so the session holding database access never
//   reads attacker-written text.
//
//   node review.mjs queue --out <dir> [--seed] [--include <user_id>,...]
//       stdout: ids, usernames, statuses, report ids and URL hashes for pending entries,
//       reported entries, and approved entries whose URL differs from the one last reviewed.
//       <dir>/queue.json holds the full rows (URLs, names, report reasons) for the other
//       commands and the judge. --seed creates the URL ledger from today's approved entries;
//       without it a missing ledger is an error, so losing the file cannot silently bless
//       whatever URLs are live. --include adds the named entries whatever their status, so a
//       logged decision can be reversed.
//   node review.mjs check <user_id> --queue <dir>/queue.json --out <dir>
//       checks that entry's URL; stdout: numbers and booleans only. <dir>/check.json adds page
//       text, links and raw values; screenshots too.
//   node review.mjs set-status <user_id> <approved|rejected> --from <status> --queue <dir>/queue.json
//       guarded on the status and on the URL hash recorded in queue.json
//   node review.mjs resolve-reports <report_id>[,<report_id>...]
//
// Connection details live in config.json beside this file (gitignored; see config.example.json).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const REVIEW_STATUSES = ['approved', 'rejected', 'requires_review'];
// The directory's own iframe (client/src/components/WebsiteFrame.svelte).
const DIRECTORY_SANDBOX = 'allow-forms allow-modals allow-popups allow-scripts allow-same-origin allow-downloads';
const LEDGER_PATH = resolve(here, 'reviewed-urls.json');

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function config() {
  const path = resolve(here, 'config.json');
  if (!existsSync(path)) fail(`missing ${path}; copy config.example.json and fill it in`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sql(query) {
  const { sshHost, dbContainer } = config();
  const remote = `sudo docker exec -i ${dbContainer} sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -At -v ON_ERROR_STOP=1'`;
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshHost, remote], {
    input: query,
    encoding: 'utf8',
  });
  if (r.status !== 0) fail(`database query failed (exit ${r.status}):\n${r.stderr}`);
  return r.stdout.trim();
}

function json(query) {
  return JSON.parse(sql(query));
}

function positiveInt(raw, what) {
  if (!/^\d+$/.test(raw ?? '')) fail(`${what} must be a positive integer, got ${raw}`, 2);
  return Number(raw);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function md5(text) {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

function readLedger() {
  return existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) : null;
}

function writeLedger(ledger) {
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

const URL_SQL = 'coalesce(manual_website_url, website_url)';

function queue(args) {
  const out = option(args, '--out');
  if (!out) fail('usage: queue --out <dir>', 2);
  mkdirSync(out, { recursive: true });

  const pending = json(`
    select coalesce(json_agg(q order by q.created_at), '[]') from (
      select id as user_id, github_username, coalesce(name_override, name) as name,
             ${URL_SQL} as url, is_user_submitted, created_at
      from "user" where status = 'requires_review' and user_removed = false
    ) q;`);
  const reported = json(`
    select coalesce(json_agg(e order by e.first_reported), '[]') from (
      select u.id as user_id, u.github_username, coalesce(u.name_override, u.name) as name,
             ${URL_SQL} as url, u.status, u.user_removed, min(r.created_at) as first_reported,
             json_agg(json_build_object('report_id', r.id, 'reason', r.reason, 'created_at', r.created_at)
                      order by r.created_at) as reports
      from report r join "user" u on u.id = r.reported_user_id
      where r.resolved = false group by u.id
    ) e;`);
  const includeIds = (option(args, '--include') ?? '').split(',').filter(Boolean).map((raw) => positiveInt(raw, 'user_id'));
  const included = includeIds.length
    ? json(`
    select coalesce(json_agg(i), '[]') from (
      select id as user_id, github_username, ${URL_SQL} as url, status, user_removed
      from "user" where id in (${includeIds.join(',')})
    ) i;`)
    : [];
  const approved = json(`
    select coalesce(json_agg(a), '[]') from (
      select id as user_id, github_username, ${URL_SQL} as url
      from "user" where status = 'approved' and user_removed = false
    ) a;`);

  // An approved entry's URL can change without review: the owner removes and resubmits it, or
  // the weekly GitHub refresh picks up a new profile website. The ledger remembers the URL each
  // approved entry was last reviewed at. First run: record today's approved set as the baseline.
  let ledger = readLedger();
  const seeded = args.includes('--seed');
  if (ledger === null && !seeded) fail(`URL ledger ${LEDGER_PATH} is missing; restore it, or run queue --seed to start a new baseline`);
  if (seeded) ledger = { approved: {} };
  const changed = [];
  for (const entry of approved) {
    const known = ledger.approved[entry.user_id];
    if (known === undefined || seeded) ledger.approved[entry.user_id] = entry.url;
    else if (known !== entry.url) changed.push({ ...entry, previously_reviewed_url: known });
  }
  writeLedger(ledger);

  writeFileSync(resolve(out, 'queue.json'), JSON.stringify({ pending, reported, url_changed: changed, included }, null, 2));
  // GitHub usernames are [A-Za-z0-9-]; everything free-form stays in queue.json.
  const safe = (e) => ({ user_id: e.user_id, github_username: e.github_username, url_md5: e.url ? md5(e.url) : null });
  console.log(
    JSON.stringify(
      {
        ledger_seeded: seeded,
        pending: pending.map((e) => ({ ...safe(e), is_user_submitted: e.is_user_submitted, created_at: e.created_at })),
        reported: reported.map((e) => ({
          ...safe(e),
          status: e.status,
          user_removed: e.user_removed,
          report_ids: e.reports.map((r) => r.report_id),
        })),
        url_changed: changed.map(safe),
        included: included.map((e) => ({ ...safe(e), status: e.status, user_removed: e.user_removed })),
        full_details: resolve(out, 'queue.json'),
      },
      null,
      2,
    ),
  );
}

// The URL an entry had when the queue was read, from that run's queue.json.
function queuedUrl(args, id) {
  const path = option(args, '--queue');
  if (!path) fail('--queue <dir>/queue.json is required', 2);
  const q = JSON.parse(readFileSync(path, 'utf8'));
  const entry = [...q.pending, ...q.reported, ...q.url_changed, ...q.included].find((e) => e.user_id === id);
  if (!entry?.url) fail(`user ${id} has no URL in ${path}`, 2);
  return entry.url;
}

function setStatus(args) {
  const id = positiveInt(args[0], 'user_id');
  const status = args[1];
  const from = option(args, '--from');
  if (!['approved', 'rejected'].includes(status)) fail('status must be approved or rejected', 2);
  if (!REVIEW_STATUSES.includes(from)) fail(`--from must be one of ${REVIEW_STATUSES.join(', ')}`, 2);
  const url = queuedUrl(args, id);
  // The URL is compared by hash so no submitter-controlled text is spliced into SQL.
  const rows = json(`
    with done as (
      update "user" set status = '${status}'
      where id = ${id} and status = '${from}' and user_removed = false
        and md5(${URL_SQL}) = '${md5(url)}'
      returning id, github_username, status
    ) select coalesce(json_agg(done), '[]') from done;`);
  if (rows.length !== 1 || rows[0].id !== id) {
    fail(`entry ${id} is no longer ${from} at the checked URL (or was removed); nothing changed`, 3);
  }
  const ledger = readLedger() ?? { approved: {} };
  if (status === 'approved') ledger.approved[id] = url;
  else delete ledger.approved[id];
  writeLedger(ledger);
  console.log(JSON.stringify(rows[0]));
}

function resolveReports(args) {
  const ids = (args[0] ?? '').split(',').map((raw) => positiveInt(raw, 'report_id'));
  if (ids.length === 0) fail('usage: resolve-reports <report_id>[,<report_id>...]', 2);
  const resolved = json(`
    with done as (
      update report set resolved = true where id in (${ids.join(',')}) and resolved = false
      returning id
    ) select coalesce(json_agg(id), '[]') from done;`);
  console.log(JSON.stringify({ resolved_report_ids: resolved, already_resolved_or_missing: ids.filter((i) => !resolved.includes(i)) }));
}

function isPrivateAddress(address) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

const hostVerdicts = new Map();
async function hostAllowed(hostname) {
  if (!hostVerdicts.has(hostname)) {
    const verdict = lookup(hostname, { all: true }).then(
      (addresses) => addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address)),
      () => true, // unresolvable: let the browser fail the request itself, as a visitor's would
    );
    hostVerdicts.set(hostname, verdict);
  }
  return hostVerdicts.get(hostname);
}

async function check(args) {
  const id = positiveInt(args[0], 'user_id');
  const out = option(args, '--out');
  if (!out) fail('usage: check <user_id> --queue <dir>/queue.json --out <dir>', 2);
  const url = queuedUrl(args, id);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`not a URL: ${url}`, 2);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail(`only http(s) URLs are checked (user ${id})`, 2);
  mkdirSync(out, { recursive: true });

  // Playwright comes from the client's dev dependencies (run `npm install` in client/ once).
  const require = createRequire(new URL('../../../client/package.json', import.meta.url));
  const { chromium, devices } = require('playwright');
  const browser = await chromium.launch();
  const blocked = [];
  const full = { user_id: id, url, checked_at: new Date().toISOString() };
  const summary = { user_id: id, url_md5: md5(url), checked_at: full.checked_at };

  // A submitted URL must not reach this machine's network: loopback, LAN and link-local
  // destinations are refused, as are non-web schemes.
  async function guard(context) {
    // WebSockets bypass context.route, so refuse them all; no criterion depends on one.
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    await context.route('**/*', async (route) => {
      const target = new URL(route.request().url());
      if (target.protocol === 'data:' || target.protocol === 'blob:') return route.continue();
      if (!['http:', 'https:'].includes(target.protocol) || !(await hostAllowed(target.hostname))) {
        blocked.push(`${target.protocol}//${target.hostname}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
  }

  async function visit(label, contextOptions) {
    const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
    await guard(context);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url().slice(0, 200)}`));
    page.on('response', (r) => r.status() >= 400 && failedRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 200)}`));
    const m = { label };
    const text = {};
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      m.http_status = response?.status() ?? null;
      text.final_url = page.url();
      m.https = new URL(page.url()).protocol === 'https:';
      m.redirected_off_site = new URL(page.url()).hostname.replace(/^www\./, '') !== parsed.hostname.replace(/^www\./, '');
      if (label === 'desktop') {
        const headers = response?.headers() ?? {};
        text.x_frame_options = headers['x-frame-options'] ?? null;
        text.csp_frame_ancestors =
          (headers['content-security-policy'] ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-ancestors')) ?? null;
        m.has_x_frame_options = text.x_frame_options !== null;
        m.has_csp_frame_ancestors = text.csp_frame_ancestors !== null;
      }
      m.timing_ms = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav
          ? { ttfb: Math.round(nav.responseStart), dom_content_loaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) }
          : null;
      });
      m.network_idle_within_5s = await page
        .waitForLoadState('networkidle', { timeout: 5_000 })
        .then(() => true, () => false);
      Object.assign(
        m,
        await page.evaluate(() => ({
          lang: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(document.documentElement.lang) ? document.documentElement.lang : null,
          has_viewport_meta: Boolean(document.querySelector('meta[name="viewport"]')),
          horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          page_height_px: document.documentElement.scrollHeight,
          word_count: (document.body?.innerText ?? '').split(/\s+/).filter(Boolean).length,
        })),
      );
      if (label === 'desktop') {
        text.title = await page.title();
        text.text_excerpt = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 5000);
        text.links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href))].slice(0, 60));
      }
      await page.screenshot({ path: resolve(out, `${label}.png`) });
      if (m.page_height_px <= 8000) await page.screenshot({ path: resolve(out, `${label}-full.png`), fullPage: true });
    } catch (error) {
      text.error = String(error).split('\n')[0].slice(0, 300);
      m.error_code = /net::ERR_[A-Z_]+/.exec(text.error)?.[0] ?? (/Timeout/.test(text.error) ? 'timeout' : 'other');
    }
    m.console_error_count = consoleErrors.length;
    m.page_error_count = pageErrors.length;
    m.failed_request_count = failedRequests.length;
    full[label] = { ...m, ...text, console_errors: consoleErrors.slice(0, 10), page_errors: pageErrors.slice(0, 10), failed_requests: failedRequests.slice(0, 10) };
    await context.close();
    return m;
  }

  summary.desktop = await visit('desktop', { viewport: { width: 1366, height: 900 } });
  summary.mobile = await visit('mobile', { ...devices['iPhone 13'] });

  // Embed the site exactly as the directory does: inside a webofdevs.com page (so a
  // frame-ancestors policy naming webofdevs.com applies), with the directory's sandbox.
  // Chromium swaps a refused frame for a chrome-error:// document.
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await guard(context);
  const page = await context.newPage();
  const host = 'https://webofdevs.com/__review-embed-check';
  await page.route(host, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><iframe src="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" sandbox="${DIRECTORY_SANDBOX}" style="width:1300px;height:820px;border:0"></iframe>`,
    }),
  );
  try {
    await page.goto(host, { waitUntil: 'load', timeout: 30_000 });
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const frameUrl = frame?.url() ?? '';
    summary.embeddable = Boolean(frame) && !frameUrl.startsWith('chrome-error:') && page.url() === host;
    summary.embed_frame_refused = frameUrl.startsWith('chrome-error:');
    await page.screenshot({ path: resolve(out, 'embedded.png') });
  } catch (error) {
    summary.embeddable = false;
    full.embed_error = String(error).split('\n')[0].slice(0, 300);
    summary.embed_error_code = /net::ERR_[A-Z_]+/.exec(full.embed_error)?.[0] ?? 'other';
  }
  await context.close();
  await browser.close();

  full.blocked_private_destinations = [...new Set(blocked)];
  summary.blocked_private_destination_count = full.blocked_private_destinations.length;
  summary.details = resolve(out, 'check.json');
  full.summary = summary;
  writeFileSync(resolve(out, 'check.json'), JSON.stringify(full, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'queue':
    queue(args);
    break;
  case 'check':
    await check(args);
    break;
  case 'set-status':
    setStatus(args);
    break;
  case 'resolve-reports':
    resolveReports(args);
    break;
  default:
    fail('usage: review.mjs queue --out <dir> [--seed] | check <user_id> --queue <file> --out <dir> | set-status <user_id> <approved|rejected> --from <status> --queue <file> | resolve-reports <report_id>[,...]', 2);
}
