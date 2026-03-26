# Forewarn Dashboard

> Continuously tests watched projects against open PRs in their dependency trees.
> Any proposed upstream change that would break a watched project appears here before it lands.

**Last updated:** Thu, 26 Mar 2026 03:05:10 GMT

## Summary

| | All time | Last 7 days |
|---|---|---|
| PRs tested | 11 | 11 |
| ✅ Passing | 0 | 0 |
| ❌ Failing | 1 | 1 |

> ⚠️ **1 upstream PR currently break one or more watched projects.** See details below.

---

## Watched Projects

### [dcmjs-org/dcmjs](https://github.com/dcmjs-org/dcmjs)

#### ❌ Failing PRs (1)

| Upstream PR | Package | Title | Tested | |
|---|---|---|---|---|
| [babel/babel#17865](https://github.com/babel/babel/pull/17865) | `@babel/runtime-corejs3` | Fix(parser): flow parser small fixes | 6d ago | [log](https://github.com/pieper/forewarn/actions/runs/23316848529) |


---

### cornerstonejs/cornerstone3D

_No upstream PRs tested yet._

---

### OHIF/Viewers

_No upstream PRs tested yet._

---

### ImagingDataCommons/slim

_No upstream PRs tested yet._


---

## About

Forewarn walks the full dependency tree of each watched project nightly, finds open PRs on
every package, and runs the project's test suite against each proposed change using
[`npm overrides`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides).
Each PR commit SHA is tested exactly once and results are stored permanently.

[Configuration](forewarn.config.json) · [State](forewarn-state.json) · [Workflows](.github/workflows)
