#!/usr/bin/env bash
# =============================================================================
# Rebuild the public tree (yinon11/involoops) from this repo's HEAD.
#
#   ./scripts/publish-public-tree.sh          # dry run: show what would change
#   ./scripts/publish-public-tree.sh --push   # commit and push it
#
# Work in THIS repo; publish when you are satisfied. The public repo is a pure
# subset: every file it carries is byte-identical to the private one, and the
# only difference is which files are present. Nothing is rewritten or redacted
# on the way out, so keep it that way — if something cannot be published as
# written, fix it here or add it to the exclusion list, don't sanitize on copy.
#
# Which paths stay behind: scripts/public-tree-exclude.txt (why: the exclusion
# table in docs/open-source-readiness.md).
#
# Neither working clone is touched. The tree is assembled in a temp directory
# and pushed from a temp clone of the public remote.
# =============================================================================

set -euo pipefail

PUBLIC_REMOTE="${PUBLIC_REMOTE:-https://github.com/yinon11/involoops.git}"
PUBLIC_BRANCH="${PUBLIC_BRANCH:-main}"
EXCLUDE_FILE="scripts/public-tree-exclude.txt"

PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1
[[ -n "${1:-}" && "${1:-}" != "--push" ]] && { echo "usage: $0 [--push]" >&2; exit 2; }

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# ---------- Preflight --------------------------------------------------------

[[ -f "$EXCLUDE_FILE" ]] || die "$EXCLUDE_FILE is missing — nothing would be excluded."
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty. Commit or stash first: the public tree is built from HEAD, so uncommitted work would be silently left out."

SRC_SHA="$(git rev-parse --short HEAD)"
SRC_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "Source: $SRC_BRANCH @ $SRC_SHA ($(git ls-tree -r HEAD --name-only | wc -l) tracked files)"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"; mkdir -p "$STAGE"

# ---------- Assemble the public tree from HEAD -------------------------------

log "Exporting HEAD"
git archive HEAD | tar -x -C "$STAGE"

log "Applying $EXCLUDE_FILE"
REMOVED=0
while IFS= read -r raw; do
  line="${raw%%#*}"                      # strip trailing comments
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  case "$line" in
    /*|*..*) die "refusing suspicious exclude pattern: $line" ;;
  esac
  target="$STAGE/${line%/}"
  if [[ -e "$target" ]]; then
    n=$(find "$target" -type f | wc -l)
    rm -rf "$target"
    REMOVED=$((REMOVED + n))
    printf '  - %-45s (%s files)\n' "$line" "$n"
  else
    printf '  . %-45s (not present)\n' "$line"
  fi
done < "$EXCLUDE_FILE"
echo "  excluded $REMOVED files in total"

# ---------- Guard: nothing secret may reach the public tree ------------------
# A belt alongside the exclusion list's braces: if a new secret-shaped file
# appears and nobody updated the list, stop here rather than publish it.

log "Scanning the staged tree for anything that must never be published"
FOUND=""
while IFS= read -r f; do FOUND+="  $f"$'\n'; done < <(
  cd "$STAGE" && find . -type f \
    \( -name '.sops.yaml' -o -name '*.enc.json' -o -name '*.pem' -o -name '*.p12' \
       -o -name '*.pfx' -o -name '*.key' -o -name '.env' -o -name '.env.*' \) \
    ! -name '*.example' | sed 's|^\./||' | sort
)
while IFS= read -r f; do
  grep -lqE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' "$STAGE/$f" 2>/dev/null && FOUND+="  $f (contains a PRIVATE KEY block)"$'\n'
done < <(cd "$STAGE" && grep -rlE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' . 2>/dev/null | sed 's|^\./||' | sort)

if [[ -n "$FOUND" ]]; then
  printf '%s' "$FOUND" >&2
  die "the staged tree holds secret-shaped files (above). Add them to $EXCLUDE_FILE, or remove them from the repo."
fi
echo "  clean"

# ---------- Guard: the public docs must stand on their own -------------------
# Two failures this catches, both of which shipped at least once:
#   1. A published doc links to a file the exclusion list withholds. The link
#      404s, and it names the withheld file, which advertises what we kept back.
#   2. A published doc links to a file that was never written at all.
# Markdown is fatal: a reader clicks those. Source-comment mentions are only
# reported, because internal breadcrumbs like "see KNOWN_ISSUES.md" are useful
# in the private repo and harmless as a stale comment in the public one.

log "Checking published docs for broken links and references to withheld paths"
cat > "$WORK/check-docs.mjs" <<'NODE'
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";

const [stage, excludeFile] = process.argv.slice(2);

// A withheld entry is only a leak when the text uses it AS A PATH. "server/"
// must not fire on every prose use of the word "server", so a directory entry
// is required to carry its trailing slash. For a file we also match the bare
// basename, because that is how docs actually cite each other ("see
// KNOWN_ISSUES.md") and that citation is the thing that dangles.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEFT = "(^|[^A-Za-z0-9._/-])";
const withheld = readFileSync(excludeFile, "utf8")
  .split("\n")
  .map((l) => l.split("#")[0].trim())
  .filter(Boolean)
  .map((entry) => {
    const isDir = entry.endsWith("/");
    const path = entry.replace(/\/$/, "");
    const pats = isDir
      ? [`${LEFT}${esc(path)}/`]
      : [`${LEFT}${esc(path)}(?![A-Za-z0-9-])`];
    const base = path.split("/").pop();
    if (!isDir && base !== path && base.includes(".")) {
      pats.push(`${LEFT}${esc(base)}(?![A-Za-z0-9-])`);
    }
    return { path, re: new RegExp(pats.join("|"), "m") };
  });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const files = walk(stage).map((f) => relative(stage, f));
const docs = files.filter((f) => f.endsWith(".md"));
const code = files.filter((f) => /\.(ts|tsx|js|mjs|sh|yml|yaml)$/.test(f));

const broken = [];
const leaks = [];
const mentions = [];

for (const doc of docs) {
  const body = readFileSync(join(stage, doc), "utf8");

  // (1) relative markdown links that resolve to nothing in the public tree
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:|#|\/\/)/.test(raw)) continue;
    const target = raw.split("#")[0].split("?")[0];
    if (!target) continue;
    const abs = resolve(stage, dirname(doc), target);
    if (!abs.startsWith(resolve(stage) + sep)) continue; // escapes the tree; not ours to judge
    if (!existsSync(abs)) broken.push(`${doc}  ->  ${relative(stage, abs)}`);
  }

  // (2) prose that names a withheld path, link or not
  for (const w of withheld) {
    if (w.re.test(body)) leaks.push(`${doc}  names  ${w.path}`);
  }
}

for (const f of code) {
  const body = readFileSync(join(stage, f), "utf8");
  for (const w of withheld) {
    if (w.re.test(body)) mentions.push(`${f}  names  ${w.path}`);
  }
}

const show = (label, rows) => {
  console.log(`  ${label}: ${rows.length}`);
  for (const r of [...new Set(rows)].sort()) console.log(`      ${r}`);
};

if (mentions.length) {
  console.log(`  note: ${new Set(mentions).size} source comment(s) mention a withheld path (not fatal)`);
}
if (broken.length || leaks.length) {
  if (broken.length) show("broken links in published docs", broken);
  if (leaks.length) show("published docs naming a withheld path", leaks);
  process.exit(1);
}
console.log("  clean");
NODE
node "$WORK/check-docs.mjs" "$STAGE" "$ROOT/$EXCLUDE_FILE" \
  || die "published docs reference files the public tree does not carry (above). Fix the wording here, or stop excluding the target."

# ---------- Compare against the published tree -------------------------------

log "Cloning $PUBLIC_REMOTE"
# The gh credential helper is configured per-repo in these checkouts, not
# globally, so a fresh clone has no way to authenticate unless we say so.
CRED="${GIT_CREDENTIAL_HELPER:-!gh auth git-credential}"
PUB="$WORK/public"

if git -c credential.helper="$CRED" clone --quiet --branch "$PUBLIC_BRANCH" \
     "$PUBLIC_REMOTE" "$PUB" 2>/dev/null; then
  git -C "$PUB" config credential.helper "$CRED"
  PUB_BEFORE="$(git -C "$PUB" rev-parse --short HEAD)"
else
  # A brand-new repository has no branches, so --branch cannot resolve and the
  # clone fails exactly as it would if the remote were unreachable. Tell the
  # two apart before assuming we may seed it: an empty remote is the one case
  # where there is nothing to compare against and nothing to lose.
  #
  # This path exists so that re-creating the public repository (see
  # PUBLISHING.md) still goes through the exclusion list and the guards above,
  # instead of someone hand-pushing a tree that skipped both.
  if ! REMOTE_HEADS="$(git -c credential.helper="$CRED" ls-remote --heads "$PUBLIC_REMOTE" 2>/dev/null)"; then
    die "could not reach the public remote. Check 'gh auth status', or set GIT_CREDENTIAL_HELPER."
  fi
  if [[ -n "$REMOTE_HEADS" ]]; then
    die "the remote has branches but '$PUBLIC_BRANCH' is not one of them:
$REMOTE_HEADS
Refusing to guess which branch to publish to."
  fi
  log "The remote is empty — seeding '$PUBLIC_BRANCH' with the first commit"
  git init --quiet -b "$PUBLIC_BRANCH" "$PUB"
  git -C "$PUB" remote add origin "$PUBLIC_REMOTE"
  git -C "$PUB" config credential.helper "$CRED"
  PUB_BEFORE="(empty remote)"
fi

rsync -a --delete --exclude '.git/' "$STAGE"/ "$PUB"/
git -C "$PUB" add -A

if git -C "$PUB" diff --cached --quiet; then
  log "The public tree already matches $SRC_SHA — nothing to publish."
  exit 0
fi

log "Changes relative to published $PUB_BEFORE"
git -C "$PUB" diff --cached --stat | tail -30
echo
printf '  added:    %s\n' "$(git -C "$PUB" diff --cached --name-status | grep -c '^A')"
printf '  modified: %s\n' "$(git -C "$PUB" diff --cached --name-status | grep -c '^M')"
printf '  deleted:  %s\n' "$(git -C "$PUB" diff --cached --name-status | grep -c '^D')"
echo
echo "  files the public tree would LOSE:"
git -C "$PUB" diff --cached --name-status | awk '$1=="D"{print "    "$2}' | head -20

if [[ "$PUSH" != "1" ]]; then
  cat <<EOF

=================================================================
 Dry run — nothing was pushed, and neither working clone was touched.
 Re-run with --push to publish:

   ./scripts/publish-public-tree.sh --push
=================================================================
EOF
  exit 0
fi

# ---------- Publish ----------------------------------------------------------

log "Committing and pushing to $PUBLIC_BRANCH"
git -C "$PUB" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit --quiet -m "Public tree — rebuilt $(date -u +%Y-%m-%d) from the private head ($SRC_SHA), minus the exclusion list"
git -C "$PUB" push --quiet -u origin "$PUBLIC_BRANCH"
log "Published $(git -C "$PUB" rev-parse --short HEAD) (was $PUB_BEFORE)"
