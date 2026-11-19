const REPOSITORY = 'a961282799-crypto/talent-tree-app'
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=10`

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function compareVersions(a, b) {
  const first = a.split('.').map(Number)
  const second = b.split('.').map(Number)
  return (first[0] - second[0]) || (first[1] - second[1]) || (first[2] - second[2])
}

/** Select the newest published release with an uploaded, checksummed APK. */
export function findUpdate(releases, installed) {
  if (!Array.isArray(releases) || !VERSION.test(installed)) throw new Error('Invalid release data or installed version')
  let newest = null
  for (const release of releases) {
    const tag = release?.tag_name
    if (release?.draft || release?.prerelease || typeof tag !== 'string' || !tag.startsWith('v')) continue
    const version = tag.slice(1)
    if (!VERSION.test(version) || compareVersions(version, newest?.version ?? installed) <= 0) continue

    const name = `talent-tree-${version}.apk`
    const url = `https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`
    const apk = Array.isArray(release.assets) && release.assets.find(asset =>
      asset?.name === name && asset.state === 'uploaded' && asset.browser_download_url === url &&
      Number.isInteger(asset.size) && asset.size > 0 && asset.size <= 2_147_483_647 &&
      /^sha256:[a-f0-9]{64}$/.test(asset.digest)
    )
    if (apk) newest = { version, size: apk.size, sha256: apk.digest.slice(7) }
  }
  return newest
}
