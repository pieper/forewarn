#!/usr/bin/env node
/**
 * discover.mjs
 *
 * For each watched repo in forewarn.config.json:
 *   1. Fetch its package.json from GitHub
 *   2. For each dependency, look up its GitHub repo via the npm registry
 *   3. Fetch open PRs for that repo
 *   4. Filter out any PR SHA already in forewarn-state.json
 *
 * Outputs a JSON array of job descriptors to stdout (for use as a GitHub
 * Actions matrix). Progress and errors go to stderr.
 */

import { readFileSync } from 'fs'

const config = JSON.parse(readFileSync('forewarn.config.json', 'utf8'))
const state  = JSON.parse(readFileSync('forewarn-state.json', 'utf8'))

const GITHUB_TOKEN    = process.env.GITHUB_TOKEN
const MAX_JOBS        = config.max_jobs_per_run ?? 40
const GITHUB_HEADERS  = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept':        'application/vnd.github.v3+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

// ── helpers ────────────────────────────────────────────────────────────────

async function githubGet(url) {
  const res = await fetch(url, { headers: GITHUB_HEADERS })
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('X-RateLimit-Reset')
    throw new Error(`GitHub rate limited – resets at ${new Date(reset * 1000).toISOString()}`)
  }
  if (!res.ok) return null
  return res.json()
}

async function fetchRaw(repo, filename) {
  for (const branch of ['main', 'master']) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filename}`
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } })
    if (res.ok) return res.json()
  }
  return null
}

/** Resolve an npm package name → "owner/repo" via the npm registry */
const repoCache = new Map()
async function npmToGithubRepo(packageName) {
  if (repoCache.has(packageName)) return repoCache.get(packageName)

  try {
    const res  = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
    if (!res.ok) { repoCache.set(packageName, null); return null }
    const data = await res.json()
    const raw  = data?.repository
    if (!raw)   { repoCache.set(packageName, null); return null }

    const url   = typeof raw === 'string' ? raw : (raw.url ?? '')
    const match = url.match(/github\.com[/:]([^/]+\/[^/.\s]+?)(?:\.git|\/|$)/)
    const result = match ? match[1] : null
    repoCache.set(packageName, result)
    return result
  } catch {
    repoCache.set(packageName, null)
    return null
  }
}

// ── main ───────────────────────────────────────────────────────────────────

const jobs = []

for (const watched of config.watch) {
  if (jobs.length >= MAX_JOBS) break
  console.error(`\n── ${watched.repo}`)

  const packageJson = await fetchRaw(watched.repo, 'package.json')
  if (!packageJson) {
    console.error(`  ✗ could not fetch package.json`)
    continue
  }

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  }

  for (const [packageName] of Object.entries(allDeps)) {
    if (jobs.length >= MAX_JOBS) break

    // Skip noise: type stubs, internal workspace packages, non-npm refs
    if (packageName.startsWith('@types/'))   continue
    if (allDeps[packageName]?.startsWith('workspace:')) continue

    const depRepo = await npmToGithubRepo(packageName)
    if (!depRepo) continue

    console.error(`  checking ${packageName} → ${depRepo}`)

    const prs = await githubGet(
      `https://api.github.com/repos/${depRepo}/pulls?state=open&per_page=100`
    )
    if (!prs?.length) continue

    for (const pr of prs) {
      if (jobs.length >= MAX_JOBS) break

      const stateKey = `${watched.repo}|${depRepo}|${pr.number}|${pr.head.sha}`
      if (state[stateKey] !== undefined) continue   // already tested this SHA

      jobs.push({
        watched_repo:     watched.repo,
        install_command:  watched.install_command,
        setup_command:    watched.setup_command    ?? '',
        test_command:     watched.test_command,
        package_manager:  watched.package_manager  ?? 'npm',
        yarn_version:     watched.yarn_version      ?? '1',
        timeout_minutes:  watched.timeout_minutes   ?? 20,
        dep_repo:         depRepo,
        dep_package:      packageName,
        pr_number:        pr.number,
        pr_sha:           pr.head.sha,
        // Truncate title to keep Actions matrix JSON small
        pr_title:         pr.title.replace(/"/g, "'").substring(0, 100),
        pr_url:           pr.html_url,
        state_key:        stateKey,
      })

      console.error(`    + PR #${pr.number}: ${pr.title.substring(0, 60)}`)
    }
  }
}

console.error(`\nTotal new jobs: ${jobs.length}`)
// Write job array to stdout for the workflow to consume
process.stdout.write(JSON.stringify(jobs))
