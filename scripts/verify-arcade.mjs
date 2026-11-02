import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const id = 'kata-skifree-clone-gpt-6-luna-extra-high';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const data = JSON.parse(await readFile(new URL('../arcade/manifest.json', import.meta.url), 'utf8'));
assert.ok([1, 2].includes(data.schemaVersion));
assert.equal(data.gameId, id);
assert.equal(data.playUrl, `https://intrepion.github.io/${id}/`);
assert.ok(Array.isArray(data.screenshots));
const paths = new Set();
for (const image of data.screenshots) {
  assert.match(image.path, /^arcade\/screenshots\/[a-z0-9-]+\.jpg$/);
  assert.ok(!paths.has(image.path)); paths.add(image.path);
  assert.ok(typeof image.alt === 'string' && image.alt.trim());
  const p = image.provenance;
  if (p?.kind === 'existing_repository_capture') {
    assert.ok(typeof p.sourcePath === 'string' && p.sourcePath.trim());
    assert.equal(p.deployedBuild, null); assert.equal(p.captureDate, null);
  } else {
    assert.equal(data.schemaVersion, 2); assert.equal(p?.kind, 'ci_gameplay_capture');
    assert.match(p.sourcePath, /^arcade\/capture-evidence\/[a-z0-9-]+\.png$/);
    assert.match(p.sourceSha256, /^[a-f0-9]{64}$/); assert.match(p.captureCommit, /^[a-f0-9]{40}$/);
    assert.match(p.workflowRunId, /^[0-9]+$/); assert.match(p.publishedFilesVerifiedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(!Number.isNaN(Date.parse(p.publishedFilesVerifiedAt)) && p.inputHashes && Object.keys(p.inputHashes).length);
    for (const [name, hash] of Object.entries(p.inputHashes)) { assert.match(name, /^[a-zA-Z0-9._/-]+$/); assert.ok(!name.startsWith('/') && !name.split('/').includes('..')); assert.match(hash, /^[a-f0-9]{64}$/); }
    if (p.captureRecordPath !== undefined) {
      assert.match(p.captureRecordPath, /^arcade\/capture-evidence\/[a-z0-9-]+\.json$/);
      assert.match(p.captureRecordSha256, /^[a-f0-9]{64}$/);
      const rawRecord = await readFile(new URL(`../${p.captureRecordPath}`, import.meta.url));
      assert.equal(digest(rawRecord), p.captureRecordSha256);
      const record = JSON.parse(rawRecord);
      assert.equal(record.sourceCommit, p.captureCommit);
      assert.equal(String(record.runId), p.workflowRunId);
      assert.deepEqual(record.inputs, p.inputHashes);
    }
    const original = await readFile(new URL(`../${p.sourcePath}`, import.meta.url));
    assert.equal(original.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(digest(original), p.sourceSha256);
  }
  const bytes = await readFile(new URL(`../${image.path}`, import.meta.url));
  assert.equal(digest(bytes), image.sha256); assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
}
console.log(`Verified ${data.screenshots.length} captures for ${id}`);
