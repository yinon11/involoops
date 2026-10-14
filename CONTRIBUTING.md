# Contributing

Thanks for considering a contribution.

## Before you open a pull request: the CLA

Every contribution requires accepting the Contributor Licence Agreement,
[`CLA.md`](./CLA.md). On your first pull request a bot posts a link to it; to
accept, reply on the pull request with exactly:

> I have read the CLA Document and I hereby sign the CLA

You sign once, and it covers all your later contributions. The pull request's
CLA check stays red until you do.

**Why.** This project is dual-licensed: the public licence in `LICENSE`, and a
commercial licence for anyone who wants to use it without that licence's
obligations. That only works if one party holds the copyright to the whole
codebase. Without a CLA, each contributor retains copyright over their lines and
the project can never be relicensed again — which would remove the commercial
option entirely.

The CLA does not take your copyright away. You keep it, and you grant the
maintainer the rights needed to license the combined work, including under the
commercial licence. Your contribution also stays available under the public
licence.

If you cannot sign it, please still open an issue describing the problem — a good
bug report is a real contribution, and it needs no agreement.

## Getting set up

```bash
npm install
cp .env.example .env    # fill in values; see .env.example for what each does
npm run dev             # http://localhost:3000
```

`docker-compose.yml` brings up Postgres, MinIO and the app together. `.env.example`
is the authoritative list of environment variables.

## Working on a change

Read **`AGENTS.md`** first — it is the contributor guide proper: stack, repository
layout, the domain boundary between `src/features/expenses` and
`src/features/generator` (enforced by ESLint), conventions, and the
security-sensitive areas.

A few things worth knowing up front:

- **Next.js 16 / React 19.** Patterns from older Next.js docs often do not apply.
  Prefer what the codebase already does; `node_modules/next/dist/docs/` is the
  in-repo reference.
- **Multi-tenancy is not optional.** Every query is scoped by user or business
  entity. A change that could return another tenant's row will not be merged.
- **Compliance code is load-bearing.** Document numbering, the canonical JSON
  behind signatures, and the uniform-structure export are constrained by Israeli
  tax law, not by taste. Changing the canonical document invalidates every
  existing signature — see the comments in `src/lib/signing/canonical-document.ts`.
- **Never commit secrets or real data.** No `.env*`, no customer data, no real
  tax IDs or email addresses in fixtures, seeds or tests. This applies to test
  data as much as to code.

## Before you push

```bash
npm run lint
npm run build
```

Both should be clean for the files you touched. Keep changes scoped — avoid
drive-by refactors, and avoid adding new top-level markdown files unless asked.

## Commit messages and pull requests

Explain **why**, not just what. If a change is subtle, say what would break if
someone reverted it. Describe how you verified it — for anything touching
document rendering, numbering or signing, say what you actually ran.

## Reporting security issues

Do not open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Name and logo

The code's licence does not cover the project's name or logo. See
[`TRADEMARK.md`](./TRADEMARK.md).
