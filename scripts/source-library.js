#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ── Workspace Detection ──────────────────────────────────────────────
function findWorkspaceRoot() {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  const markers = ['SOUL.md', 'AGENTS.md'];
  let dir = path.resolve(__dirname, '..', '..', '..');
  for (let i = 0; i < 10; i++) {
    if (markers.some(m => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const WORKSPACE = findWorkspaceRoot();
const SOURCES_DIR = path.join(WORKSPACE, 'life', 'source');
const DATA_DIR = path.join(WORKSPACE, 'data');
const SKILL_DATA = path.join(__dirname, '..', 'data');
const REFS_FILE = path.join(SKILL_DATA, 'source-refs.json');
const QUEUE_FILE = path.join(DATA_DIR, 'source-queue.json');

// ── Template ─────────────────────────────────────────────────────────
const SUMMARY_TEMPLATE = `# {TITLE}

**Source:** {URL}
**Author:** {AUTHOR}
**Date:** {DATE}
**Type:** {TYPE}
**Tags:** {TAGS}
**Decay:** {DECAY}

## Key Claims
{CLAIMS}

## Notable Quotes
{QUOTES}

## Analysis
{ANALYSIS}

## Context
{CONTEXT}

## Related Sources
{RELATED}
`;

// ── Keyword-to-tag mapping ───────────────────────────────────────────
const KEYWORD_TAG_MAP = {
  'bitcoin': ['crypto', 'bitcoin'], 'btc': ['crypto', 'bitcoin'],
  'ethereum': ['crypto', 'ethereum'], 'eth': ['crypto', 'ethereum'],
  'solana': ['crypto', 'solana'], 'defi': ['crypto', 'defi'],
  'ai': ['ai-agents'], 'llm': ['ai-agents'], 'agent': ['ai-agents'],
  'macro': ['macro', 'economics'], 'fed': ['macro', 'economics'],
  'inflation': ['macro', 'economics'], 'recession': ['macro', 'economics'],
  'geopolitics': ['geopolitics'], 'war': ['geopolitics'],
  'startup': ['venture', 'startups'], 'vc': ['venture', 'startups'],
  'security': ['security'], 'exploit': ['security'],
  'saas': ['saas', 'business'], 'trump': ['politics'], 'election': ['politics'],
};

// ── Utilities ────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function suggestTags(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  const tags = new Set();
  for (const [kw, t] of Object.entries(KEYWORD_TAG_MAP)) {
    if (lower.includes(kw)) t.forEach(tag => tags.add(tag));
  }
  return Array.from(tags).join(', ');
}

function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts[key] = args[++i];
      } else {
        opts[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { opts, positional };
}

function parseSummary(content, slug) {
  const lines = content.split('\n');
  const source = { slug };
  source.title = lines.find(l => l.startsWith('# '))?.slice(2) || slug;
  source.url = extractMeta(content, 'Source:');
  source.author = extractMeta(content, 'Author:');
  source.date = extractMeta(content, 'Date:');
  source.type = extractMeta(content, 'Type:');
  source.tags = extractMeta(content, 'Tags:').split(',').map(t => t.trim()).filter(Boolean);
  source.decayRate = extractMeta(content, 'Decay:') || 'normal';
  return source;
}

function extractMeta(content, key) {
  const m = content.match(new RegExp(`\\*\\*${key}\\*\\*\\s*(.+)`));
  return m ? m[1].trim() : '';
}

function formatClaims(claims) {
  if (!claims) return '';
  if (typeof claims === 'string') return claims.split(/\n|\\n|\. /).map(c => c.trim()).filter(Boolean).map(c => `- ${c}`).join('\n');
  if (Array.isArray(claims)) return claims.map(c => `- ${c}`).join('\n');
  return '';
}

function formatQuotes(quotes) {
  if (!quotes) return '';
  if (typeof quotes === 'string') return quotes.split('\n').map(q => q.trim()).filter(Boolean).map(q => `- "${q}"`).join('\n');
  if (Array.isArray(quotes)) return quotes.map(q => `- "${q}"`).join('\n');
  return '';
}

function calculateFreshness(dateStr, decayRate = 'normal') {
  if (!dateStr) return { tier: '🔴', label: 'Stale', days: 999 };
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  let adj = days;
  if (decayRate === 'fast') adj *= 2;
  if (decayRate === 'slow') adj *= 0.5;
  if (adj <= 7) return { tier: '🟢', label: 'Fresh', days };
  if (adj <= 30) return { tier: '🟡', label: 'Recent', days };
  if (adj <= 90) return { tier: '🟠', label: 'Aging', days };
  return { tier: '🔴', label: 'Stale', days };
}

// ── Refs ─────────────────────────────────────────────────────────────
function loadRefs() {
  try { return JSON.parse(fs.readFileSync(REFS_FILE, 'utf8')); } catch { return {}; }
}
function saveRefs(refs) { ensureDir(SKILL_DATA); fs.writeFileSync(REFS_FILE, JSON.stringify(refs, null, 2)); }

// ── Core: save ───────────────────────────────────────────────────────
function saveSource(name, data) {
  const slug = data.slug || slugify(name);
  const sourceDir = path.join(SOURCES_DIR, slug);
  ensureDir(sourceDir);

  let tags = data.tags;
  if (!tags && (data.claims || data.analysis)) {
    tags = suggestTags((data.claims || '') + ' ' + (data.analysis || ''));
    if (tags) console.log(`Auto-generated tags: ${tags}`);
  }

  let related = '';
  if (data.related) related = data.related.split(',').map(s => `- [[${s.trim()}]]`).join('\n');

  const content = SUMMARY_TEMPLATE
    .replace('{TITLE}', data.title || name)
    .replace('{URL}', data.url || '')
    .replace('{AUTHOR}', data.author || '')
    .replace('{DATE}', data.date || new Date().toISOString().split('T')[0])
    .replace('{TYPE}', data.type || '')
    .replace('{TAGS}', tags || '')
    .replace('{DECAY}', data.decay || 'normal')
    .replace('{CLAIMS}', formatClaims(data.claims))
    .replace('{QUOTES}', formatQuotes(data.quotes))
    .replace('{ANALYSIS}', data.analysis || '')
    .replace('{CONTEXT}', data.context || '')
    .replace('{RELATED}', related);

  fs.writeFileSync(path.join(sourceDir, 'summary.md'), content);
  console.log(`Saved source: ${slug}`);

  // Show related sources
  const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tagList.length > 0) {
    const all = listSources();
    const rel = all.filter(s => s.slug !== slug && tagList.filter(t => s.tags.includes(t)).length >= 2);
    if (rel.length) {
      console.log('\nRelated sources:');
      rel.forEach(s => console.log(`  ${s.slug} - ${s.title}`));
    }
  }
  return slug;
}

// ── Core: list ───────────────────────────────────────────────────────
function listSources(filter = {}) {
  if (!fs.existsSync(SOURCES_DIR)) return [];
  const sources = [];
  for (const entry of fs.readdirSync(SOURCES_DIR)) {
    if (entry === 'README.md') continue;
    const sp = path.join(SOURCES_DIR, entry, 'summary.md');
    if (!fs.existsSync(sp)) continue;
    const source = parseSummary(fs.readFileSync(sp, 'utf8'), entry);
    if (filter.type && source.type !== filter.type) continue;
    if (filter.tag && !source.tags.includes(filter.tag)) continue;
    if (filter.decay) source.freshness = calculateFreshness(source.date, source.decayRate);
    sources.push(source);
  }
  return sources.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ── Core: stats ──────────────────────────────────────────────────────
function getStats() {
  if (!fs.existsSync(SOURCES_DIR)) return { total: 0, byType: {}, byTag: {}, diskUsage: 0 };
  const stats = { total: 0, byType: {}, byTag: {}, diskUsage: 0 };
  for (const entry of fs.readdirSync(SOURCES_DIR)) {
    if (entry === 'README.md') continue;
    const sp = path.join(SOURCES_DIR, entry, 'summary.md');
    if (!fs.existsSync(sp)) continue;
    stats.total++;
    const s = parseSummary(fs.readFileSync(sp, 'utf8'), entry);
    stats.byType[s.type] = (stats.byType[s.type] || 0) + 1;
    s.tags.forEach(t => { stats.byTag[t] = (stats.byTag[t] || 0) + 1; });
    stats.diskUsage += fs.statSync(sp).size;
  }
  return stats;
}

// ── Connections (absorbed from source-connections.js) ────────────────
function readAllSourcesFull() {
  if (!fs.existsSync(SOURCES_DIR)) return [];
  const sources = [];
  for (const entry of fs.readdirSync(SOURCES_DIR)) {
    if (entry === 'README.md') continue;
    const sp = path.join(SOURCES_DIR, entry, 'summary.md');
    if (!fs.existsSync(sp)) continue;
    try {
      const content = fs.readFileSync(sp, 'utf8');
      const lines = content.split('\n');
      const title = lines.find(l => l.startsWith('# '))?.slice(2).trim() || entry;
      const tagsStr = (lines.find(l => l.includes('**Tags:**')) || '').replace('**Tags:**', '').trim();
      const tags = tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const ci = lines.findIndex(l => l.includes('## Key Claims'));
      const ce = lines.findIndex((l, i) => i > ci && l.startsWith('##'));
      const claims = (ce > -1 ? lines.slice(ci + 1, ce) : lines.slice(ci + 1)).join(' ').toLowerCase();
      sources.push({ slug: entry, title, tags, claims, content: content.toLowerCase() });
    } catch {}
  }
  return sources;
}

function runConnections(subCmd) {
  const sources = readAllSourcesFull();
  if (sources.length === 0) { console.log('No sources found.'); return; }

  // Tag connections
  const tagConns = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const shared = sources[i].tags.filter(t => sources[j].tags.includes(t));
      if (shared.length > 0) tagConns.push({ s1: sources[i], s2: sources[j], sharedTags: shared, strength: shared.length });
    }
  }

  // Keyword connections
  const keywords = ['agents','openclaw','crypto','bitcoin','ethereum','saas','macro','trading','venture','startup','llm','market','capital','inflation','geopolitics','platform'];
  const kwConns = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const shared = keywords.filter(k => sources[i].claims.includes(k) && sources[j].claims.includes(k));
      if (shared.length >= 3) kwConns.push({ s1: sources[i], s2: sources[j], sharedKeywords: shared, strength: shared.length });
    }
  }

  const allConns = [...tagConns, ...kwConns];

  // Clusters via DFS
  const visited = new Set();
  const graph = {};
  sources.forEach(s => graph[s.slug] = []);
  allConns.forEach(c => {
    if (c.strength >= 2) { graph[c.s1.slug].push(c.s2.slug); graph[c.s2.slug].push(c.s1.slug); }
  });
  const clusters = [];
  function dfs(node, cluster) { if (visited.has(node)) return; visited.add(node); cluster.push(node); graph[node].forEach(n => dfs(n, cluster)); }
  sources.forEach(s => {
    if (!visited.has(s.slug)) {
      const cl = []; dfs(s.slug, cl);
      if (cl.length > 1) {
        const allTags = cl.flatMap(slug => sources.find(x => x.slug === slug).tags);
        const tc = {}; allTags.forEach(t => tc[t] = (tc[t] || 0) + 1);
        const top = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
        clusters.push({ topic: top.join(', ') || 'Mixed', sources: cl, size: cl.length });
      }
    }
  });

  const connectedSlugs = new Set(); allConns.forEach(c => { connectedSlugs.add(c.s1.slug); connectedSlugs.add(c.s2.slug); });
  const orphans = sources.filter(s => !connectedSlugs.has(s.slug));

  if (subCmd === '--clusters') {
    console.log('# Source Clusters\n');
    clusters.forEach((cl, i) => { console.log(`## ${i + 1}. ${cl.topic} (${cl.size} sources)`); cl.sources.forEach(slug => console.log(`- ${sources.find(s => s.slug === slug).title}`)); console.log(); });
    if (!clusters.length) console.log('No clusters found.');
  } else if (subCmd === '--orphans') {
    console.log('# Orphan Sources\n');
    orphans.forEach(s => console.log(`- ${s.title} (${s.tags.join(', ') || 'no tags'})`));
    if (!orphans.length) console.log('All sources connected.');
  } else {
    console.log('# Source Connection Graph\n');
    console.log(`Total sources: ${sources.length}`);
    console.log(`Connections: ${allConns.length}`);
    console.log(`Clusters: ${clusters.length}`);
    console.log(`Orphans: ${orphans.length}\n`);
    if (clusters.length) { console.log('## Clusters'); clusters.forEach((cl, i) => { console.log(`\n### ${i + 1}. ${cl.topic} (${cl.size})`); cl.sources.forEach(slug => console.log(`- ${sources.find(s => s.slug === slug).title}`)); }); console.log(); }
    if (tagConns.length) { console.log('## Tag Connections\n'); tagConns.forEach(c => console.log(`${c.s1.title} ↔ ${c.s2.title} (${c.sharedTags.join(', ')})`)); console.log(); }
    if (orphans.length) { console.log('## Orphans\n'); orphans.forEach(s => console.log(`- ${s.title}`)); }
  }
}

// ── Conflicts (absorbed from source-conflicts.js) ───────────────────
const POS_KW = ['bullish','growth','increase','rise','surge','rally','optimistic','positive','strong','recovery','expansion','success'];
const NEG_KW = ['bearish','decline','decrease','fall','crash','dump','pessimistic','negative','weak','recession','contraction','failure'];
const ENTITIES = ['bitcoin','btc','ethereum','eth','crypto','ai','agents','llm','fed','inflation','recession','economy','china','saas','startup','venture','tesla','nvidia','trump','solana'];

function runConflicts() {
  const sources = readAllSourcesFull().filter(s => s.claims.trim());
  if (sources.length < 2) { console.log('Need at least 2 sources with Key Claims.'); return; }
  console.log(`Analyzing ${sources.length} sources for conflicts...\n`);
  const conflicts = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const s1 = sources[i], s2 = sources[j];
      const common = ENTITIES.filter(e => s1.claims.includes(e) && s2.claims.includes(e));
      const entityConflicts = [];
      for (const e of common) {
        const sent = (text) => {
          const hp = POS_KW.some(k => text.includes(k)), hn = NEG_KW.some(k => text.includes(k));
          return hp && !hn ? 'positive' : hn && !hp ? 'negative' : hp && hn ? 'mixed' : 'neutral';
        };
        const se1 = sent(s1.claims), se2 = sent(s2.claims);
        if ((se1 === 'positive' && se2 === 'negative') || (se1 === 'negative' && se2 === 'positive')) {
          entityConflicts.push({ entity: e, sentiment1: se1, sentiment2: se2 });
        }
      }
      if (entityConflicts.length) conflicts.push({ s1, s2, conflicts: entityConflicts });
    }
  }
  console.log('# Source Conflict Detection\n');
  console.log('**Note:** Heuristic — review manually.\n');
  if (!conflicts.length) { console.log('No conflicts detected.'); return; }
  console.log(`Found ${conflicts.length} potential conflict(s):\n`);
  conflicts.forEach((c, i) => {
    console.log(`## ${i + 1}. ${c.s1.title} vs ${c.s2.title}`);
    c.conflicts.forEach(ec => console.log(`  Conflicting on: ${ec.entity} (${ec.sentiment1} vs ${ec.sentiment2})`));
    console.log();
  });
}

// ── Queue (absorbed from source-queue.js) ────────────────────────────
function loadQueue() { try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { return []; } }
function saveQueue(q) { ensureDir(DATA_DIR); fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); }

function runQueue(subCmd, args) {
  const { opts, positional } = parseArgs(args);
  switch (subCmd) {
    case 'add': {
      const url = positional[0];
      if (!url) { console.error('Usage: queue add "url" [--note "..."]'); process.exit(1); }
      const queue = loadQueue();
      if (queue.find(i => i.url === url)) { console.log('Already in queue.'); return; }
      queue.push({ id: Date.now(), url, note: opts.note || '', added: new Date().toISOString(), processed: false });
      saveQueue(queue);
      console.log(`Added to queue: ${url}`);
      break;
    }
    case 'list': {
      const q = loadQueue();
      if (!q.length) { console.log('Queue is empty.'); return; }
      console.log(`Reading Queue (${q.length} items)\n`);
      q.forEach((item, i) => {
        console.log(`${i + 1}. ${item.url}`);
        if (item.note) console.log(`   Note: ${item.note}`);
      });
      break;
    }
    case 'next': {
      const q = loadQueue();
      if (!q.length) { console.log('Queue is empty.'); return; }
      const next = q.find(i => !i.processed) || q[0];
      console.log(`Next: ${next.url}`);
      if (next.note) console.log(`Note: ${next.note}`);
      console.log(`${q.filter(i => !i.processed).length} remaining`);
      break;
    }
    case 'done': {
      const target = positional[0];
      if (!target) { console.error('Usage: queue done "url-or-index"'); process.exit(1); }
      const q = loadQueue();
      let item;
      if (!isNaN(target)) { item = q[parseInt(target) - 1]; } else { item = q.find(i => i.url === target); }
      if (!item) { console.error('Not found in queue.'); return; }
      const newQ = q.filter(i => i.id !== item.id);
      saveQueue(newQ);
      console.log(`Removed: ${item.url} (${newQ.length} remaining)`);
      break;
    }
    default:
      console.log('Usage: queue add|list|next|done');
  }
}

// ── Teach (absorbed from source-teach.js) ────────────────────────────
function runTeach(topic, limit = 20) {
  if (!topic) { console.error('Usage: teach "topic" [--limit 20]'); process.exit(1); }
  if (!fs.existsSync(SOURCES_DIR)) { console.log('No sources found.'); return; }

  const topicWords = topic.toLowerCase().split(/\s+/);
  const allSources = [];
  for (const entry of fs.readdirSync(SOURCES_DIR)) {
    if (entry === 'README.md') continue;
    const sp = path.join(SOURCES_DIR, entry, 'summary.md');
    if (!fs.existsSync(sp)) continue;
    const content = fs.readFileSync(sp, 'utf8');
    const lower = content.toLowerCase();
    const hasMatch = topicWords.some(w => lower.includes(w));
    if (!hasMatch) continue;
    const s = parseSummary(content, entry);
    const am = content.match(/## Analysis\n(.*?)(?:\n##|$)/s);
    s.fullAnalysis = am ? am[1].trim() : '';
    s.analysisSummary = s.fullAnalysis.split(/[.!?]/)[0]?.trim() + '.' || '';
    const cm = content.match(/## Key Claims\n(.*?)(?:\n##|$)/s);
    s.claims = cm ? cm[1].trim().split('\n').map(l => l.replace(/^- /, '').trim()).filter(Boolean) : [];
    allSources.push(s);
  }

  const sources = allSources.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, limit);
  if (!sources.length) { console.log(`No sources found for: ${topic}`); return; }

  console.log(`# What you know about: ${topic}\n`);
  console.log(`## Sources (${sources.length})`);
  sources.forEach(s => console.log(`- ${s.title} (${s.date}) — ${s.analysisSummary}`));
  console.log();

  // Key insights: claims grouped by shared keywords
  const STOPWORDS = new Set(['that','this','with','from','have','been','were','they','their','them','then','than','when','what','which','where','will','would','could','should','about','into','more','most','also','just','like','over','such','some','only','other','each','every','between','both','through','during','before','after','above','below']);
  const kwGroups = {};
  for (const s of sources) {
    for (const claim of s.claims) {
      const words = claim.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
      for (const w of words) {
        if (!kwGroups[w]) kwGroups[w] = [];
        kwGroups[w].push({ claim, source: s.slug });
      }
    }
  }
  const sig = Object.entries(kwGroups).filter(([, v]) => new Set(v.map(c => c.source)).size >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  console.log('## Key Insights');
  if (sig.length) {
    sig.forEach(([kw, claims]) => {
      console.log(`**${kw.charAt(0).toUpperCase() + kw.slice(1)}:**`);
      Array.from(new Set(claims.map(c => c.claim))).slice(0, 3).forEach(c => console.log(`- ${c}`));
      console.log();
    });
  } else { console.log('- No significant patterns found\n'); }

  // Timeline
  console.log('## Timeline');
  sources.filter(s => s.claims.length).forEach(s => { console.log(`**${s.date}:** ${s.title}`); console.log(`- ${s.claims[0]}\n`); });
}

// ── Import (absorbed from source-import.js) ──────────────────────────
function runImport(filePath) {
  if (!filePath || !fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { console.error(`JSON parse error: ${e.message}`); process.exit(1); }
  if (!Array.isArray(data)) { console.error('JSON must be an array'); process.exit(1); }

  let imported = 0, skipped = 0;
  for (const item of data) {
    try {
      if (typeof item === 'string') {
        const slug = slugify(new URL(item).hostname.replace('www.', ''));
        if (fs.existsSync(path.join(SOURCES_DIR, slug, 'summary.md'))) { skipped++; continue; }
        saveSource(item, { title: item, url: item, type: 'article', context: 'needs-review' });
        imported++;
      } else if (item?.url) {
        const name = item.title || item.url;
        const slug = slugify(name);
        if (fs.existsSync(path.join(SOURCES_DIR, slug, 'summary.md'))) { skipped++; continue; }
        saveSource(name, { title: item.title || '', url: item.url, author: item.author || '', type: item.type || 'article', tags: item.tags || '', claims: item.claims || '', analysis: item.analysis || '', context: item.context || '' });
        imported++;
      } else { skipped++; }
    } catch { skipped++; }
  }
  console.log(`\nImport: ${imported} imported, ${skipped} skipped`);
}

// ── Setup ────────────────────────────────────────────────────────────
function runSetup() {
  ensureDir(SOURCES_DIR);
  ensureDir(DATA_DIR);
  ensureDir(SKILL_DATA);
  console.log('Source Library ready.');
  console.log(`  Sources: ${SOURCES_DIR}`);
  console.log(`  Queue: ${QUEUE_FILE}`);
  console.log('Share any URL to get started.');
}

// ── CLI ──────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'save': {
      const { opts } = parseArgs(rest);
      if (!opts.name) { console.error('Error: --name is required'); process.exit(1); }
      saveSource(opts.name, { title: opts.name, ...opts });
      break;
    }
    case 'list': {
      const { opts } = parseArgs(rest);
      const filter = { type: opts.type, tag: opts.tag, decay: !!opts.decay };
      const sources = listSources(filter);
      sources.forEach(s => {
        let out = `${s.slug} (${s.type}) - ${s.title}`;
        if (s.freshness) out = `${s.freshness.tier} ${out} (${s.freshness.days}d ago)`;
        console.log(out);
      });
      break;
    }
    case 'search':
      console.log(JSON.stringify({ note: 'Use OpenClaw memory_search tool to search sources. Sources in life/source/ are automatically indexed.' }));
      break;
    case 'stats': {
      const stats = getStats();
      console.log(`Total sources: ${stats.total}`);
      console.log(`Disk usage: ${(stats.diskUsage / 1024).toFixed(2)} KB`);
      if (Object.keys(stats.byType).length) { console.log('\nBy type:'); Object.entries(stats.byType).forEach(([t, c]) => console.log(`  ${t}: ${c}`)); }
      if (Object.keys(stats.byTag).length) { console.log('\nBy tag:'); Object.entries(stats.byTag).forEach(([t, c]) => console.log(`  ${t}: ${c}`)); }
      break;
    }
    case 'connections': runConnections(rest[0]); break;
    case 'conflicts': runConflicts(); break;
    case 'queue': runQueue(rest[0], rest.slice(1)); break;
    case 'teach': {
      const { opts, positional } = parseArgs(rest);
      runTeach(positional[0], parseInt(opts.limit) || 20);
      break;
    }
    case 'import': {
      const { positional } = parseArgs(rest);
      runImport(positional[0]);
      break;
    }
    case 'setup': runSetup(); break;
    default:
      console.log(`Usage: node source-library.js <command> [options]

Commands:
  save --name "..." --url "..." --tags "..." --summary "..."
  list [--type tweet] [--tag crypto] [--decay]
  search "query"          (delegates to OpenClaw memory_search)
  stats                   Library statistics
  connections [--clusters|--orphans]
  conflicts               Detect contradictions
  queue add|list|next|done
  teach "topic" [--limit 20]
  import file.json
  setup                   First-run directory creation`);
  }
}

module.exports = { saveSource, listSources, getStats, slugify, parseSummary, SOURCES_DIR, WORKSPACE };

if (require.main === module) main();
