# Arcade metadata

`arcade/manifest.json` is this game’s v2 manifest. Image paths are relative to the published site root; each image has a SHA-256 and source provenance. An empty screenshot array means no verified images are available. Existing captures have unknown date and deployed-build identity; they are not fresh automated captures. Run `node scripts/verify-arcade.mjs` after edits.

CI gameplay captures use the v2 manifest with original PNG evidence, capture source commit, workflow run, input hashes, and the time those files were checked against the published site. The verification is historical, not continuous; captures are reviewed snapshots.
