#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'source-library.js');
let tmpDir;
let passed = 0, failed = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srclib-test-'));
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function run(args) {
  return execSync(`node "${SCRIPT}" ${args}`, {
    env: { ...process.env, OPENCLAW_WORKSPACE: tmpDir },
    encoding: 'utf8',
    timeout: 10000
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

setup();

try {
  test('setup creates directories', () => {
    run('setup');
    assert(fs.existsSync(path.join(tmpDir, 'life', 'source')), 'life/source not created');
    assert(fs.existsSync(path.join(tmpDir, 'data')), 'data not created');
  });

  test('save creates source file with correct format', () => {
    const out = run('save --name "Test Article" --url "https://example.com" --slug "test-article" --tags "test, demo" --summary "A test"');
    assert(out.includes('Saved source: test-article'), 'save output missing');
    const file = path.join(tmpDir, 'life', 'source', 'test-article', 'summary.md');
    assert(fs.existsSync(file), 'summary.md not created');
    const content = fs.readFileSync(file, 'utf8');
    assert(content.includes('# Test Article'), 'title missing');
    assert(content.includes('https://example.com'), 'url missing');
    assert(content.includes('test, demo'), 'tags missing');
  });

  test('list returns saved sources', () => {
    const out = run('list');
    assert(out.includes('test-article'), 'list does not show saved source');
    assert(out.includes('Test Article'), 'list missing title');
  });
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
