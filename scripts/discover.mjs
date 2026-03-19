#!/usr/bin/env node
/**
 * discover.mjs
 *
 * For each watched repo in forewarn.config.json:
 *   1. Fetch its root package.json from GitHub
 *   2. If it is a monorepo (has "workspaces" field or a lerna.json), also
 *      fetch package.json from every workspace package
 *   3. Merge all deps from all package.json files into one unique set
 *   4. For each dep, resolve its GitHub repo via the npm registry
 *   5. Fetch open PRs for that GitHub repo
 *   6. Emit any PR whose head SHA is not already in forewarn-state.json
 *
 * Outputs a JSON array of job descriptors to stdout for use as a GitHub
 * Actions matrix. Progress and diagnostics go to stderr.
 */

import { readFileSync } from 'fs'

const config = JSON.parse(readFileSync('forewarn.config.json', 'utf8'))
const state  = JSON.parse(readFileSync('forewarn-state.json', 'utf8'))

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN
const MAX_JOBS       = config.max_jobs_per_run ?? 40
const GITHUB_HEADERS = {
  Authorization:          `Bearer ${GITHUB_TOKEN}`,
  Accept:                 'application/vnd.github.v3+json',
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

/** Fetch a raw file from a GitHub repo, trying main then master. */
async function fetchRawJson(repo, filepath) {
  for (const branch of ['main', 'master']) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filepath}`
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } })
    if (res.ok) {
      try { return await res.json() } catch { return null }
    }
  }
  return null
}

/**
 * Expand workspace glob patterns (e.g. "packages/*", "extensions/**") into
 * a list of candidate paths by listing the GitHub directory tree.
 */
async function expandWorkspaceGlobs(repo, globs) {
  const paths = []
  // Get the top-level tree for the repo (non-recursive is enough for one level)
  for (const glob of globs) {
    // We only handle the common patterns: "prefix/*" and "prefix/**"
    const parts   = glob.replace(/\*\*?$/, '').replace(/\/$/, '').split('/')
    const dirPath = parts.join('/')
    if (!dirPath) continue

    const tree = await githubGet(
      `https://api.github.com/repos/${repo}/contents/${dirPath}`
    )
    if (!Array.isArray(tree)) continue

    for (const entry of tree) {
      if (entry.type === 'dir') {
        paths.push(`${entry.path}/package.json`)
      }
    }
  }
  return paths
}

/**
 * Return the union of all dependencies from all package.json files in a repo.
 * Handles:
 *   - plain repos          (just root package.json)
 *   - npm/yarn workspaces  (workspaces field in root package.json)
 *   - lerna monorepos      (lerna.json with packages field)
 */
async function getAllDeps(repo) {
  const rootPkg = await fetchRawJson(repo, 'package.json')
  if (!rootPkg) {
    console.error(`  ✗ could not fetch package.json for ${repo}`)
    return {}
  }

  const allDeps = mergeDeps(rootPkg)

  // Collect workspace globs from multiple possible sources
  const workspaceGlobs = new Set()

  if (Array.isArray(rootPkg.workspaces)) {
    rootPkg.workspaces.forEach(g => workspaceGlobs.add(g))
  } else if (rootPkg.workspaces?.packages) {
    rootPkg.workspaces.packages.forEach(g => workspaceGlobs.add(g))
  }

  // Also check lerna.json for projects that use lerna without npm workspaces
  const lerna = await fetchRawJson(repo, 'lerna.json')
  if (lerna?.packages) {
    lerna.packages.forEach(g => workspaceGlobs.add(g))
  }

  if (workspaceGlobs.size > 0) {
    console.error(`  monorepo detected — ${workspaceGlobs.size} workspace glob(s): ${[...workspaceGlobs].join(', ')}`)

    const pkgPaths = await expandWorkspaceGlobs(repo, [...workspaceGlobs])
    console.error(`  found ${pkgPaths.length} workspace packages`)

    // Fetch in parallel batches of 10 to avoid hammering the API
    for (let i = 0; i < pkgPaths.length; i += 10) {
      const batch   = pkgPaths.slice(i, i + 10)
      const results = await Promise.all(batch.map(p => fetchRawJson(repo, p)))
      for (const pkg of results) {
        if (pkg) Object.assign(allDeps, mergeDeps(pkg))
      }
    }
  }

  return allDeps
}

/** Extract all dependency entries from a package.json into one flat object. */
function mergeDeps(pkg) {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  }
}

/** Resolve npm package name → "owner/repo" via the npm registry. */
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

  const allDeps = await getAllDeps(watched.repo)
  const depCount = Object.keys(allDeps).length
  console.error(`  ${depCount} unique dependencies across all packages`)

  for (const [packageName, versionSpec] of Object.entries(allDeps)) {
    if (jobs.length >= MAX_JOBS) break

    // Skip noise: type stubs, workspace-local refs, non-registry refs
    if (packageName.startsWith('@types/'))              continue
    if (String(versionSpec).startsWith('workspace:'))  continue
    if (String(versionSpec).startsWith('file:'))       continue
    if (String(versionSpec).startsWith('link:'))       continue

    const depRepo = await npmToGithubRepo(packageName)
    if (!depRepo) continue

    // Skip packages that live inside the same monorepo (self-referential)
    if (depRepo.toLowerCase() === watched.repo.toLowerCase()) continue

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
        watched_repo:    watched.repo,
        install_command: watched.install_command,
        setup_command:   watched.setup_command    ?? '',
        test_command:    watched.test_command,
        package_manager: watched.package_manager  ?? 'npm',
        yarn_version:    watched.yarn_version      ?? '1',
        timeout_minutes: watched.timeout_minutes   ?? 20,
        dep_repo:        depRepo,
        dep_package:     packageName,
        pr_number:       pr.number,
        pr_sha:          pr.head.sha,
        pr_title:        pr.title.replace(/"/g, "'").substring(0, 100),
        pr_url:          pr.html_url,
        state_key:       stateKey,
      })

      console.error(`    + PR #${pr.number}: ${pr.title.substring(0, 60)}`)
    }
  }
}

console.error(`\nTotal new jobs: ${jobs.length}`)
process.stdout.write(JSON.stringify(jobs))
