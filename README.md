# Forewarn Dashboard

> Continuously tests watched projects against open PRs in their dependency trees.
> Any proposed upstream change that would break a watched project appears here before it lands.

**Last updated:** _(not yet run)_

## Watched Projects

- [dcmjs-org/dcmjs](https://github.com/dcmjs-org/dcmjs)
- [cornerstonejs/cornerstone3D](https://github.com/cornerstonejs/cornerstone3D)
- [OHIF/Viewers](https://github.com/OHIF/Viewers)
- [ImagingDataCommons/slim](https://github.com/ImagingDataCommons/slim)

This dashboard will populate automatically after the first nightly run.

## Setup

1. Fork or clone this repo into your GitHub org
2. The workflow runs on a schedule — no secrets needed beyond the default `GITHUB_TOKEN`
3. Adjust `forewarn.config.json` to change watched repos, test commands, or job limits
4. Trigger a first run manually via **Actions → Forewarn Nightly → Run workflow**

## About

Forewarn walks the full dependency tree of each watched project nightly, finds open PRs on
every package, and runs the project's test suite against each proposed change using
[`npm overrides`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides).
Each PR commit SHA is tested exactly once and results are stored permanently.

[Configuration](forewarn.config.json) · [State](forewarn-state.json) · [Workflows](.github/workflows)
