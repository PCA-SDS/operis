import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const changelogPath = path.resolve('CHANGELOG.md')
const changelogSectionPath = path.resolve('scripts/changelog-section.sh')

const VERSION_HEADING = /^# (\d+\.\d+\.\d+) \(/

function readChangelogLines() {
  return fs.readFileSync(changelogPath, 'utf8').split('\n')
}

function listVersionHeadings(lines) {
  return lines.map((line) => line.match(VERSION_HEADING)?.[1]).filter((version) => version !== undefined)
}

function stepIndex(workflow, stepName) {
  const index = workflow.indexOf(`- name: ${stepName}`)
  assert.notEqual(index, -1, `Expected workflow to contain step "${stepName}"`)
  return index
}

test('CHANGELOG.md never repeats a version heading', () => {
  const versions = listVersionHeadings(readChangelogLines())

  assert.ok(
    versions.length > 0,
    'No `# <version> (` headings matched CHANGELOG.md — the heading format drifted and this guard would pass vacuously',
  )

  const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))]

  assert.deepEqual(
    duplicates,
    [],
    `Duplicate version heading(s): ${duplicates.join(', ')}. scripts/changelog-section.sh scans for the first "# <version> (" and exits at the next "# " line, so a second heading for the same version silently truncates the release notes — and still exits 0, so nothing downstream can tell half the notes from all of them. This collides when a release is cut from main while develop holds an in-progress draft for the same version (#5014, #5017); reconcile the two sections into one instead of letting the merge keep both.`,
  )
})

test('changelog-section.sh round-trips the section it extracts', () => {
  const lines = readChangelogLines()

  const startIndex = lines.findIndex((line) => VERSION_HEADING.test(line))
  assert.notEqual(startIndex, -1, 'CHANGELOG.md must open with a `# <version> (<date>)` section')

  const version = lines[startIndex].match(VERSION_HEADING)[1]
  const nextHeadingIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('# '))
  const body = lines.slice(startIndex + 1, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)

  const trimTrailingBlanks = () => {
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  }
  while (body.length > 0 && body[0].trim() === '') body.shift()
  trimTrailingBlanks()
  if (body[body.length - 1] === '---') {
    body.pop()
    trimTrailingBlanks()
  }

  const result = spawnSync('bash', [changelogSectionPath, version, '--changelog', changelogPath], { encoding: 'utf8' })

  assert.equal(
    result.status,
    0,
    `changelog-section.sh ${version} exited ${result.status}; release.yml feeds this straight into the GitHub Release body. stderr: ${result.stderr}`,
  )
  assert.equal(
    result.stdout,
    `${body.join('\n')}\n`,
    `changelog-section.sh ${version} did not return the section CHANGELOG.md actually holds for that version. It must emit every line up to the next "# " heading, with the trailing "---" separator and surrounding blank lines stripped — anything shorter is the silent truncation that publishes half a release's notes (#5017).`,
  )
})

