# Contributing to `zcash-faucet`

Thanks for taking the time to contribute. zcash-faucet gives developers Zcash testnet TAZ from the terminal (`npx zcash-faucet <address>`), with proof-of-work instead of accounts.

This project follows the standards of Zcash development. The primary reference is the
[librustzcash styleguides](https://github.com/zcash/librustzcash/blob/main/CONTRIBUTING.md#styleguides).
Where this file is silent, follow that guide. Where this project differs (it is JavaScript,
not Rust), the differences are spelled out below.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Security Issues](#security-issues)
- [I Have a Question](#i-have-a-question)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)
- [Styleguides](#styleguides)
  - [Git Usage](#git-usage)
  - [Commit Messages](#commit-messages)
  - [Changelog Entries](#changelog-entries)
  - [Coding Style](#coding-style)
- [Project Notes](#project-notes)

## Code of Conduct

Everyone taking part in this project is expected to uphold the
[Zcash Code of Conduct](https://github.com/zcash/zcash/blob/master/code_of_conduct.md).

## Security Issues

> **Never report a security issue, vulnerability, or bug that includes sensitive information
> in a public issue, pull request, forum post, or chat.**

Report anything with implications for personal or network security as described at
[https://z.cash/support/security/](https://z.cash/support/security/). Do not open a GitHub
issue for it.

## I Have a Question

Read the [README](README.md) first, then search the [existing issues](../../issues). If you
still need help, ask on the [Zcash Community Forum](https://forum.zcashcommunity.com) or open an
issue with as much context as you can (what you ran, what you expected, what happened, your OS
and Node version).

## Reporting Bugs

### Before submitting a bug report

- Make sure it is a bug and not an environment problem (for example an unsupported Node
  version or a lightwalletd server being down).
- Search the [issues](../../issues?q=label%3Abug) to see if it has already been reported.
- Collect:
  - OS, CPU architecture, Node version, and the package version (`npm ls zcash-faucet` or `npx zcash-faucet@latest --version` where available)
  - the exact command you ran and its full output, **with any seed, spending key or private
    data removed** (addresses and txids on testnet are fine)
  - whether you can reproduce it reliably, and whether an older version behaves the same

### How to submit a good bug report

- Open an [issue](../../issues/new) and leave it unlabelled; the maintainer will triage it.
- Describe the expected behaviour and the actual behaviour.
- Give **reproduction steps** someone else can follow. A reduced test case is best.
- Bugs that cannot be reproduced are marked `needs-repro` and are not worked on until they can be.
- A proposed fix speeds things up. If you send one, include a failing test in a commit
  **before** the commit that fixes it (see [Git Usage](#git-usage)).

## Suggesting Enhancements

### Before submitting an enhancement

- Check the README and the latest version; the feature may already exist behind a flag.
- Search the [issues](../../issues). If it has been suggested, comment there instead of opening a new one.
- Make the case that it fits the scope of the project and helps most users, not a small subset.
- Trivial PRs (typo, link or pure style changes) from unknown contributors are not accepted, to
  discourage airdrop farming. Please report these as issues instead.

### How to submit a good enhancement suggestion

Enhancements are tracked as [GitHub issues](../../issues). Include:

- a **clear, descriptive title**
- a **step-by-step description** of the proposed change
- the **current behaviour**, the **behaviour you want instead**, and why; alternatives you tried
- **why it helps most users**, and other projects that solved the same problem, if any

## Styleguides

### Git Usage

- `main` is the development branch. Releases are tagged `vX.Y.Z` and published to npm from
  that tag. npm is the only release channel; nothing is published from CI.
- Branch from `main` and open a pull request against `main`. Draft PRs are welcome; mark the PR
  ready for review once `npm test` passes.
- PRs are merged with merge commits so history is preserved. Squash-merge is used only for PRs
  without a clean history. Rebase-merge is not used.
- If `main` changes in a way that conflicts with your PR, rebase onto the latest `main`.

**Clean commit history:**

- Each commit is one discrete semantic change, and `npm test` passes at every commit.
- No "work in progress", "fix typo" or "address review" commits. Fold fixes into the commit
  they belong to (`git commit --fixup` + `git rebase --autosquash`, or
  [git revise](https://github.com/mystor/git-revise)).
- Keep functional changes and pure style or refactoring changes in separate commits.
- A bug fix SHOULD start with a commit that adds a failing test, followed by the fix.
- Once someone is reviewing your PR, avoid force-pushing until they are done. If you must
  rebase, post a compare link between the old and new branch tip.

### Commit Messages

- Short title (under ~120 characters) in the imperative: "Add …", "Fix …", "Drop …".
- The body explains **why** the change is needed. It can be omitted for trivial changes.
- When a commit has several human authors, add a `Co-Authored-By:` line for each.

### Changelog Entries

[CHANGELOG.md](CHANGELOG.md) is how users find out what changed and what they must do to
upgrade, so it is held to the same standard as the code.

- An entry is **required** for any change to the CLI (commands, flags, output that scripts may
  parse, exit codes), any change to the JavaScript API, any bug fix, any change in behaviour,
  and any change to privacy, security or cost properties, even when no signature changes.
- The entry goes in the **same commit** as the change, never in a separate
  "update changelog" commit.
- Entries go under `## [Unreleased]` and describe the net change **since the last release**,
  not since the last commit. If something is added and then renamed before release, there is
  one entry with the final name.
- Write for users: say what they must do differently. Internal refactors and test changes do
  not belong in the changelog.
- A released `## [x.y.z] - DATE` section is the record of what shipped. Correct it only if it
  was wrong when written.
- The `## [Unreleased]` heading always stays at the top, even when empty.
- Versions follow [Semantic Versioning](https://semver.org/).

### Coding Style

The librustzcash principles, applied to JavaScript:

- **Make invalid states unrepresentable.** Validate input at the boundary (CLI arguments,
  network responses, files on disk) and turn it into a known-good value once. Reject bad input
  with a clear error instead of passing it on.
- **Amounts are integers in zatoshis.** Never do arithmetic on ZEC/TAZ as floating point;
  convert to and from decimal only for display and parsing.
- **Prefer pure functions and immutability.** Keep side effects (network, filesystem, child
  processes, the clock) at the edges and pass them in where practical, so the logic can be
  tested without them. Use a plain `for` loop, not `map`, when the body has side effects.
- **Errors.** Throw `Error` objects with an actionable message. Never swallow an error
  silently, and never print secrets in an error.
- **Persisted data is versioned.** Anything written to disk that may be read by a later
  version must carry a version so it can be migrated.
- **Keep dependencies at a minimum.** Prefer the Node standard library. A new runtime
  dependency needs a strong reason stated in the PR.
- **Public API.** Exported functions and CLI commands are the public API. Document new or
  changed ones in the README in the same commit.
- **Tests.** `npm test` (`node --test`) must pass. New behaviour comes with a test.
- Match the style of the surrounding code: ES modules, 2-space indent, double quotes.

## Project Notes

- The repository holds the npm client (`bin/`), the faucet server (`server/`), the status page (`site/`) and deployment files (`deploy/`, `render.yaml`).
- **Never commit secrets**: faucet wallet seeds, spending keys, identity files, API tokens or `.env` files. If one is ever committed, treat it as compromised and report it as a security issue.
- Changes to proof-of-work difficulty, payout amounts or rate limits are behaviour changes: they need a changelog entry and a note in the PR about the effect on abuse and on the faucet's balance.
- The client and server talk over a small HTTP API. Keep it backward compatible with clients already installed via `npx`, or version it.

## Legal

By contributing you confirm that you wrote the contribution, have the right to submit it, and
agree that it is licensed under this project's [MIT license](LICENSE).
