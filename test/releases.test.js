import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findUpdate } from '../src/releases.js'

const digest = 'a'.repeat(64)

function release(version) {
  const name = `talent-tree-${version}.apk`
  return {
    tag_name: `v${version}`,
    assets: [{
      name,
      browser_download_url: `https://github.com/a961282799-crypto/talent-tree-app/releases/download/v${version}/${name}`,
      state: 'uploaded',
      size: 6462000,
      digest: `sha256:${digest}`,
    }],
  }
}

test('selects the highest newer version numerically, regardless of publication order', () => {
  assert.deepEqual(findUpdate([release('1.10.0'), release('1.9.0')], '1.2.1'), {
    version: '1.10.0', size: 6462000, sha256: digest,
  })
  assert.equal(findUpdate([release('1.2.1'), release('1.1.0')], '1.2.1'), null)
})

test('a release cannot hide an installable update while its official APK is missing or unverified', () => {
  const draft = { ...release('1.9.0'), draft: true }
  const preview = { ...release('1.8.0'), prerelease: true }
  const betaTag = release('1.7.0-beta')
  const pending = release('1.6.0')
  pending.assets[0].state = 'new'
  const debug = release('1.5.0')
  debug.assets[0].name = 'talent-tree-1.5.0-debug.apk'
  const wrongSource = release('1.4.0')
  wrongSource.assets[0].browser_download_url = 'https://example.invalid/talent-tree-1.4.0.apk'
  const missingDigest = release('1.3.0')
  delete missingDigest.assets[0].digest
  assert.equal(findUpdate([draft, preview, betaTag, pending, debug, wrongSource, missingDigest, release('1.2.2')], '1.2.1')?.version, '1.2.2')
})

test('an invalid response is distinguishable from having no update', () => {
  assert.throws(() => findUpdate({ message: 'rate limit' }, '1.2.1'))
  assert.equal(findUpdate([], '1.2.1'), null)
})
