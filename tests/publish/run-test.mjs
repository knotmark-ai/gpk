#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../scripts/check-release-version.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(process.argv[2] ?? path.join(repo, '.github/workflows/release.yml'), 'utf8');
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gpk-publish-test-'));
let failures = 0;
function test(name, run) {
  try { run(); console.log(`PASS: ${name}`); }
  catch (error) { failures++; console.error(`FAIL: ${name}: ${error.message}`); }
}
// Execute the workflow's actual shell bodies so these tests also cover wiring.
function step(name, optional = false) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line.trim() === `- name: ${name}`);
  if (start < 0 && optional) return '';
  assert.ok(start >= 0, `missing workflow step: ${name}`);
  let run = start + 1;
  while (run < lines.length && lines[run].trim() !== 'run: |') run++;
  assert.ok(run < lines.length, `missing shell body: ${name}`);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}
const shell = (body, cwd, env = {}) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', body], {
  cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000,
});
function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
// Each remote is a local bare Git repository; publication cases never push to GitHub.
function fixture(name) {
  const root = path.join(temporary, name);
  const destination = path.join(root, 'distribution');
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(repo, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: destination, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', path.join(root, 'remote.git'));
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  fs.mkdirSync(path.join(destination, '.github'));
  fs.writeFileSync(path.join(destination, '.github/settings.txt'), 'keep configuration\n');
  fs.writeFileSync(path.join(destination, 'obsolete.txt'), 'old content\n');
  git('add', '-A'); git('commit', '-m', 'Initialize');
  git('remote', 'add', 'origin', path.join(root, 'remote.git'));
  git('push', '-u', 'origin', 'main');
  const remoteHead = () => git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  function artifact(version, extra = '') {
    const artifacts = path.join(root, 'artifacts');
    fs.rmSync(artifacts, { recursive: true, force: true });
    const payload = path.join(artifacts, 'marketplace');
    fs.mkdirSync(payload, { recursive: true });
    fs.writeFileSync(path.join(payload, 'release.json'), JSON.stringify({ version, sourceCommit: 'a'.repeat(40) }));
    fs.writeFileSync(path.join(payload, 'SKILL.md'), `release ${version}\n${extra}`);
    const script = path.join(payload, 'probe.sh');
    fs.writeFileSync(script, '#!/bin/sh\nprintf "distribution executable\\n"\n');
    fs.chmodSync(script, 0o755);
    // Production release ZIPs normalize timestamps across versions.
    const timestamp = new Date('2000-01-01T00:00:00Z');
    for (const name of ['release.json', 'SKILL.md', 'probe.sh']) {
      fs.utimesSync(path.join(payload, name), timestamp, timestamp);
    }
    execFileSync('zip', ['-X', '-q', path.join(artifacts, `gpk-marketplace-${version}.zip`), 'release.json', 'SKILL.md', 'probe.sh'], { cwd: payload });
    // Simulate Actions' directory artifact permission loss.
    fs.chmodSync(script, 0o644);
    success(shell(step('Restore marketplace permissions', true), root));
  }
  const publish = version => shell(step('Update generated distribution'), root, {
    RELEASE_TAG: `v${version}`, SOURCE_SHA: 'a'.repeat(40), DISTRIBUTION_BRANCH: 'main',
  });
  return { root, destination, git, artifact, publish, remoteHead };
}
try {
  test('distribution sync preserves executable resources through artifact transport', () => {
    const f = fixture('permissions');
    f.artifact('0.1.0'); success(f.publish('0.1.0'));
    assert.equal(execFileSync(path.join(f.destination, 'probe.sh'), [], { encoding: 'utf8' }), 'distribution executable\n');
    assert.equal(f.git('ls-tree', 'v0.1.0', 'probe.sh').split(' ')[0], '100755');
    assert.ok(!fs.existsSync(path.join(f.destination, 'obsolete.txt')));
    assert.equal(fs.readFileSync(path.join(f.destination, '.github/settings.txt'), 'utf8'), 'keep configuration\n');
  });
  test('release retries ignore preserved configuration but reject changed package content', () => {
    const f = fixture('retries');
    f.artifact('0.1.0'); success(f.publish('0.1.0'));
    const first = f.remoteHead();
    success(f.publish('0.1.0')); assert.equal(f.remoteHead(), first);
    fs.writeFileSync(path.join(f.destination, '.github/settings.txt'), 'updated configuration\n');
    f.git('add', '.github'); f.git('commit', '-m', 'Update configuration'); f.git('push');
    const configured = f.remoteHead();
    success(f.publish('0.1.0')); assert.equal(f.remoteHead(), configured);
    f.artifact('0.2.0'); success(f.publish('0.2.0'));
    const latest = f.remoteHead();
    f.artifact('0.1.0'); success(f.publish('0.1.0')); assert.equal(f.remoteHead(), latest);
    f.artifact('0.1.0', 'changed');
    assert.notEqual(f.publish('0.1.0').status, 0);
    assert.equal(f.remoteHead(), latest);
  });
  test('distribution updates equal-sized files with normalized archive timestamps', () => {
    const f = fixture('same-size');
    f.artifact('0.1.0', 'first'); success(f.publish('0.1.0'));
    const before = f.remoteHead();
    f.artifact('0.1.1', 'other'); success(f.publish('0.1.1'));
    assert.notEqual(f.remoteHead(), before);
    assert.equal(f.git('show', 'origin/main:SKILL.md'), 'release 0.1.1\nother');
    assert.equal(JSON.parse(f.git('show', 'origin/main:release.json')).version, '0.1.1');
  });
  test('first-time publication of an older version cannot roll back the distribution branch', () => {
    const f = fixture('rollback');
    f.artifact('0.2.0'); success(f.publish('0.2.0'));
    const latest = f.remoteHead();
    f.artifact('0.1.0');
    assert.notEqual(f.publish('0.1.0').status, 0, 'older unpublished version was accepted');
    assert.equal(f.remoteHead(), latest);
    assert.equal(f.git('ls-remote', 'origin', 'refs/tags/v0.1.0'), '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, 'release.json'))).version, '0.2.0');
  });
  test('prereleases leave stable distribution untouched and do not block later patches', () => {
    for (const initialized of [false, true]) {
      const f = fixture(`prerelease-${initialized ? 'existing' : 'new'}`);
      if (initialized) {
        f.artifact('0.1.0'); success(f.publish('0.1.0'));
      }
      const before = f.remoteHead();
      const release = path.join(f.destination, 'release.json');
      const previous = fs.existsSync(release) ? fs.readFileSync(release, 'utf8') : null;
      for (const version of ['0.2.0-rc.1', '0.2.0-rc.2+build-1']) {
        f.artifact(version); success(f.publish(version));
        assert.equal(f.remoteHead(), before);
        assert.equal(f.git('status', '--porcelain'), '');
        assert.equal(f.git('ls-remote', 'origin', `refs/tags/v${version}`), '');
        assert.equal(fs.existsSync(release) ? fs.readFileSync(release, 'utf8') : null, previous);
      }
      f.artifact('0.1.1'); success(f.publish('0.1.1'));
      assert.equal(JSON.parse(fs.readFileSync(release, 'utf8')).version, '0.1.1');
      // A hyphen in build metadata does not turn a stable version into a prerelease.
      f.artifact('0.1.2+build-1'); success(f.publish('0.1.2+build-1'));
      assert.equal(JSON.parse(fs.readFileSync(release, 'utf8')).version, '0.1.2+build-1');
    }
  });
  test('destination guard rejects the source repository regardless of case', () => {
    for (const destination of ['knotmark-ai/gpk', 'Knotmark-AI/GPK']) {
      assert.notEqual(shell(step('Check destination'), temporary, { SOURCE: 'knotmark-ai/gpk', DESTINATION: destination }).status, 0);
    }
    success(shell(step('Check destination'), temporary, { SOURCE: 'knotmark-ai/gpk', DESTINATION: 'knotmark-ai/gpk-distribution' }));
  });
  test('version ordering handles numeric components, prereleases and build metadata', () => {
    const versions = ['0.1.0', '0.2.0-alpha', '0.2.0-alpha.2', '0.2.0-alpha.10', '0.2.0-beta', '0.2.0', '0.10.0', '1.0.0'];
    for (let i = 1; i < versions.length; i++) {
      assert.equal(compareVersions(versions[i], versions[i - 1]), 1);
      assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
    }
    assert.equal(compareVersions('1.0.0+a', '1.0.0+b'), 0);
    for (const invalid of ['1.0', '01.0.0', '1.0.0-01', 'latest']) assert.throws(() => compareVersions(invalid, '1.0.0'));
  });
  test('archive publication marks prereleases without misclassifying stable build metadata', () => {
    const root = path.join(temporary, 'release-flags');
    const bin = path.join(root, 'bin');
    const flags = path.join(root, 'flags.json');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/gpk-fixture.zip'), 'synthetic archive');
    fs.writeFileSync(path.join(root, 'dist/SHA256SUMS'), 'synthetic checksums');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'release') process.exit(2);
if (args[1] === 'view') process.exit(1);
if (args[1] !== 'create') process.exit(2);
fs.writeFileSync(process.env.TEST_RELEASE_FLAGS, JSON.stringify(args));
`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    for (const [version, prerelease] of [
      ['0.1.1', false], ['0.1.1+build-1', false],
      ['0.2.0-rc.1', true], ['0.2.0-rc.1+build-1', true],
    ]) {
      success(shell(step('Publish versioned archives'), root, {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_RELEASE_FLAGS: flags,
        RELEASE_TAG: `v${version}`, GH_REPO: 'example/gpk', GH_TOKEN: 'local-test-only',
      }));
      const args = JSON.parse(fs.readFileSync(flags, 'utf8'));
      assert.equal(args[2], `v${version}`);
      assert.equal(args.includes('--prerelease'), prerelease);
      assert.equal(args.includes('--latest=false'), prerelease);
      assert.ok(args.includes('--verify-tag'));
    }
  });
  test('archive publication retries accept identical assets, fill missing assets and reject changed bytes', () => {
    const root = path.join(temporary, 'archives');
    const bin = path.join(root, 'bin');
    const published = path.join(root, 'published');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/gpk-claude-0.1.0.zip'), 'archive fixture');
    fs.writeFileSync(path.join(root, 'dist/SHA256SUMS'), 'checksum fixture');
    // A local gh double tests the real workflow shell without network access.
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const [, command, , ...args] = process.argv.slice(2);
const published = process.env.TEST_RELEASE_ASSETS;
if (command === 'view') process.exit(fs.existsSync(published) ? 0 : 1);
if (command === 'create') {
  fs.mkdirSync(published);
  for (const file of args.filter(arg => !arg.startsWith('--'))) fs.copyFileSync(file, path.join(published, path.basename(file)));
} else if (command === 'download') {
  const filename = args[args.indexOf('--pattern') + 1], directory = args[args.indexOf('--dir') + 1];
  if (!fs.existsSync(path.join(published, filename))) process.exit(1);
  fs.copyFileSync(path.join(published, filename), path.join(directory, filename));
} else if (command === 'upload') {
  const destination = path.join(published, path.basename(args[0]));
  if (fs.existsSync(destination)) process.exit(1);
  fs.copyFileSync(args[0], destination);
} else process.exit(2);
`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const publish = () => {
      fs.rmSync(path.join(root, 'existing'), { recursive: true, force: true });
      return shell(step('Publish versioned archives'), root, {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_RELEASE_ASSETS: published,
        RELEASE_TAG: 'v0.1.0', GH_REPO: 'example/gpk', GH_TOKEN: 'local-test-only',
      });
    };
    success(publish()); success(publish());
    fs.unlinkSync(path.join(published, 'SHA256SUMS'));
    success(publish());
    assert.equal(fs.readFileSync(path.join(published, 'SHA256SUMS'), 'utf8'), 'checksum fixture');
    fs.writeFileSync(path.join(root, 'dist/gpk-claude-0.1.0.zip'), 'different archive');
    assert.notEqual(publish().status, 0);
    assert.equal(fs.readFileSync(path.join(published, 'gpk-claude-0.1.0.zip'), 'utf8'), 'archive fixture');
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
