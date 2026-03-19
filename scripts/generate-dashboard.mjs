#!/usr/bin/env node
/**
 * generate-dashboard.mjs
 *
 * Reads forewarn-state.json and forewarn.config.json and rewrites README.md
 * with an up-to-date dashboard including deep links to all failing PRs.
 */

import { readFileSync, writeFileSync } from 'fs'

const state  = JSON.parse(readFileSync('forewarn-state.json', 'utf8'))
const config = JSON.parse(readFileSync('forewarn.config.json', 'utf8'))

const now      = new Date().toUTCString()
const entries  = Object.values(state)

// ── helpers ────────────────────────────────────────────────────────────────

function ago(isoDate) {
  const ms      = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60)   return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48)     return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function resultBadge(result) {
  return result === 'success' ? '✅ pass' : '❌ fail'
}

function prLink(entry) {
  return `[${entry.dep_repo}#${entry.pr_number}](${entry.pr_url})`
}

function runLink(entry) {
  return `[log](${entry.run_url})`
}

// ── per-repo sections ──────────────────────────────────────────────────────

function repoSection(watchedRepo) {
  const repoEntries = entries
    .filter(e => e.watched_repo === watchedRepo)
    .sort((a, b) => new Date(b.tested_at) - new Date(a.tested_at))

  if (repoEntries.length === 0) {
    return `### ${watchedRepo}\n\n_No upstream PRs tested yet._\n`
  }

  const failures = repoEntries.filter(e => e.result === 'failure')
  const passes   = repoEntries.filter(e => e.result === 'success')

  let section = `### [${watchedRepo}](https://github.com/${watchedRepo})\n\n`

  // ── failures ──
  if (failures.length > 0) {
    section += `#### ❌ Failing PRs (${failures.length})\n\n`
    section += `| Upstream PR | Package | Title | Tested | |\n`
    section += `|---|---|---|---|---|\n`
    for (const e of failures) {
      section += `| ${prLink(e)} | \`${e.dep_package}\` | ${e.pr_title} | ${ago(e.tested_at)} | ${runLink(e)} |\n`
    }
    section += '\n'
  }

  // ── recent passes (last 10) ──
  const recentPasses = passes.slice(0, 10)
  if (recentPasses.length > 0) {
    section += `<details>\n<summary>✅ Recent passes (${passes.length})</summary>\n\n`
    section += `| Upstream PR | Package | Title | Tested |\n`
    section += `|---|---|---|---|\n`
    for (const e of recentPasses) {
      section += `| ${prLink(e)} | \`${e.dep_package}\` | ${e.pr_title} | ${ago(e.tested_at)} |\n`
    }
    section += '\n</details>\n\n'
  }

  return section
}

// ── summary stats ──────────────────────────────────────────────────────────

const totalTested   = entries.length
const totalFailing  = entries.filter(e => e.result === 'failure').length
const totalPassing  = entries.filter(e => e.result === 'success').length

// PRs tested in the last 7 days
const cutoff        = Date.now() - 7 * 24 * 60 * 60 * 1000
const recentEntries = entries.filter(e => new Date(e.tested_at).getTime() > cutoff)
const recentFailing = recentEntries.filter(e => e.result === 'failure').length
const recentPassing = recentEntries.filter(e => e.result === 'success').length

// ── assemble README ────────────────────────────────────────────────────────

const watchedRepos = config.watch.map(w => w.repo)

const readme = `# Forewarn Dashboard

> Continuously tests watched projects against open PRs in their dependency trees.
> Any proposed upstream change that would break a watched project appears here before it lands.

**Last updated:** ${now}

## Summary

| | All time | Last 7 days |
|---|---|---|
| PRs tested | ${totalTested} | ${recentEntries.length} |
| ✅ Passing | ${totalPassing} | ${recentPassing} |
| ❌ Failing | ${totalFailing} | ${recentFailing} |

${totalFailing > 0
  ? `> ⚠️ **${totalFailing} upstream PR${totalFailing > 1 ? 's' : ''} currently break one or more watched projects.** See details below.`
  : `> ✅ All tested upstream PRs are currently passing.`
}

---

## Watched Projects

${watchedRepos.map(repoSection).join('\n---\n\n')}

---

## About

Forewarn walks the full dependency tree of each watched project nightly, finds open PRs on
every package, and runs the project's test suite against each proposed change using
[\`npm overrides\`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides).
Each PR commit SHA is tested exactly once and results are stored permanently.

[Configuration](forewarn.config.json) · [State](forewarn-state.json) · [Workflows](.github/workflows)
`

writeFileSync('README.md', readme)
console.log(`Dashboard written to README.md (${entries.length} state entries, ${totalFailing} failures)`)
