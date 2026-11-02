import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const id = "kata-skifree-clone-gpt-6-luna-extra-high";
const data = JSON.parse(await readFile(new URL('../arcade/manifest.json', import.meta.url), 'utf8'));
assert.equal(data.schemaVersion, 1);
assert.equal(data.gameId, id);
assert.equal(data.playUrl, `https://intrepion.github.io/${id}/`);
assert.ok(Array.isArray(data.screenshots));
const paths = new Set();
for (const image of data.screenshots) {
  assert.match(image.path, /^arcade\/screenshots\/[a-z0-9-]+\.jpg$/);
  assert.ok(!paths.has(image.path)); paths.add(image.path);
  assert.ok(image.alt && image.provenance.sourcePath);
  assert.equal(image.provenance.kind, 'existing_repository_capture');
  assert.equal(image.provenance.deployedBuild, null);
  assert.equal(image.provenance.captureDate, null);
  const bytes = await readFile(new URL(`../${image.path}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
}
console.log(`Verified ${data.screenshots.length} existing captures for ${id}`);
