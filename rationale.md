# Forewarn

Modern software projects have deep dependency trees. When any package in that tree ships a breaking change, downstream projects find out after the fact — failed builds, broken deploys, production incidents. By then the change has already landed and the only option is reactive debugging.

The proposed change was almost always visible as a PR before it merged. Forewarn exploits that window.

## What it does

Forewarn runs on a schedule against your repository. It walks your full dependency tree, queries the GitHub API for open PRs on every package it finds, and runs your project's existing test suite against each proposed change. Results are stored keyed on the PR's head SHA — so no commit is ever tested twice, and new pushes to a PR automatically trigger a fresh run. Failures are surfaced in a dashboard and a periodic digest.

The scope is intentionally unlimited. npm packages, devDependencies, build tools, and browser engines (Chromium and Firefox both publish per-commit builds) are all valid targets. The same mechanism works for library maintainers who want early warning about their own dependencies, not just application developers.

## Implementation

The npm ecosystem has all the required building blocks:

- **`package-lock.json`** provides the full transitive dependency tree with exact SHAs
- **`pkg.pr.new`** publishes an installable build for any PR commit without touching the npm registry
- **`npm overrides`** injects a PR build at any depth in the dependency tree without modifying committed package files
- **GitHub Actions** provides scheduling, matrix job dispatch, and the API access needed to enumerate upstream PRs
- **A lightweight state store** (a JSON file in a dedicated repo is sufficient) tracks which SHAs have been tested

The core logic — walk the tree, diff against the state store, enqueue untested SHAs, run tests with the override injected, record results — is on the order of a few hundred lines. The rest is adapters for different dependency types and a digest formatter.

## What doesn't exist yet

No tool currently assembles these pieces into something a project can adopt without significant custom work. Forewarn would be that tool — a configurable, drop-in GitHub Action with adapters for npm packages, build tools, and browsers, and a standard output format for dashboards and digests.

Interested in collaborating or piloting? Feedback on the design is welcome.
