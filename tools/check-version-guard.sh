#!/bin/sh
# check-version-guard.sh — fail if shell files changed between BASE and HEAD
# without a version.js bump. Clients only pick up new shell files when the
# version changes, so forgetting the bump ships an update nobody receives.
#
# Callers: tools/hooks/pre-push (per pushed ref) and .github/workflows/ci.yml
# (on pull requests). The watched-file list lives ONLY here — do not copy it.
#
# Usage: sh tools/check-version-guard.sh BASE HEAD

BASE=$1
HEAD=$2
if [ -z "$BASE" ] || [ -z "$HEAD" ]; then
  echo "usage: sh tools/check-version-guard.sh BASE HEAD" >&2
  exit 2
fi

changed=$(git diff --name-only "$BASE".."$HEAD")
shell_changed=$(printf '%s\n' "$changed" | grep -E '^(index\.html|app\.js|parser\.js|basemap\.js|sample\.js|sw\.js|manifest\.json|favicon\.svg|icon-.*\.png|apple-touch-icon-180\.png)$')
ver_changed=$(printf '%s\n' "$changed" | grep -E '^version\.js$')

if [ -n "$shell_changed" ] && [ -z "$ver_changed" ]; then
  echo "version guard: shell files changed without a version bump:" >&2
  printf '%s\n' "$shell_changed" | sed 's/^/  /' >&2
  echo "Bump APP_VERSION in version.js (CalVer YYYY.MM.DD[.N])." >&2
  exit 1
fi

exit 0
