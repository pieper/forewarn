#!/usr/bin/env node
/**
 * merge-results.mjs
 *
 * Reads every result-*.json artifact from ./new-results/,
 * merges them into forewarn-state.json, and writes it back.
 *
 * Each result file has the shape produced by the test job:
 * {
 *   state_key, watched_repo, dep_repo, dep_package,
 *   pr_number, pr_sha, pr_title, pr_url,
 *   result,       // "success" | "failure"
 *   tested_at,    // ISO timestamp
 *   run_url
 * }
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const stateFile   = 'forewarn-state.json'
const resultsDir  = 'new-results'

const state = JSON.parse(readFileSync(stateFile, 'utf8'))

let merged = 0
let files
try {
  files = readdirSync(resultsDir).filter(f => f.endsWith('.json'))
} catch {
  console.log('No new-results directory found — nothing to merge.')
  process.exit(0)
}

for (const file of files) {
  try {
    const result = JSON.parse(readFileSync(join(resultsDir, file), 'utf8'))
    if (!result.state_key) continue
    state[result.state_key] = {
      watched_repo: result.watched_repo,
      dep_repo:     result.dep_repo,
      dep_package:  result.dep_package,
      pr_number:    result.pr_number,
      pr_sha:       result.pr_sha,
      pr_title:     result.pr_title,
      pr_url:       result.pr_url,
      result:       result.result,      // "success" | "failure"
      tested_at:    result.tested_at,
      run_url:      result.run_url,
    }
    merged++
  } catch (e) {
    console.error(`Could not parse ${file}: ${e.message}`)
  }
}

writeFileSync(stateFile, JSON.stringify(state, null, 2))
console.log(`Merged ${merged} results into ${stateFile} (${Object.keys(state).length} total entries)`)
