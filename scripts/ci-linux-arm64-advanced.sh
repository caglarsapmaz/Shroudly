#!/usr/bin/env bash
# Best-effort: cross-build the Linux arm64 advanced engine on an x64 CI runner.
# Downloads the arm64 libnetfilter_queue/libmnl/libnfnetlink dev packages into a
# sysroot and points scripts/build-core-advanced.js at it. If anything fails the
# caller ignores it (the default arm64 engine still ships; only the optional
# advanced arm64 backend is skipped).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYS="$ROOT/.ci-sysroot-arm64"
mkdir -p "$SYS/debs" "$SYS/root"

BASE="http://ports.ubuntu.com/ubuntu-ports/pool/main"
PKGS=(
  "libn/libnetfilter-queue/libnetfilter-queue-dev_1.0.5-3build1_arm64.deb"
  "libn/libnetfilter-queue/libnetfilter-queue1_1.0.5-3build1_arm64.deb"
  "libm/libmnl/libmnl-dev_1.0.4-3build2_arm64.deb"
  "libm/libmnl/libmnl0_1.0.4-3build2_arm64.deb"
  "libn/libnfnetlink/libnfnetlink-dev_1.0.1-3.2build2_arm64.deb"
  "libn/libnfnetlink/libnfnetlink0_1.0.1-3.2build2_arm64.deb"
)

cd "$SYS/debs"
for p in "${PKGS[@]}"; do
  f="$(basename "$p")"
  # Package revisions drift between Ubuntu releases; resolve the current one if
  # the pinned filename 404s.
  if ! curl -sSfLO "$BASE/$p"; then
    dir="$BASE/$(dirname "$p")/"
    name="$(curl -sSfL "$dir" | grep -oE "$(echo "$f" | sed 's/_[^_]*_arm64.deb//')_[^\"<]*_arm64.deb" | sort -u | tail -1)"
    [ -n "$name" ] && curl -sSfLO "$dir$name"
  fi
done

for d in *.deb; do dpkg-deb -x "$d" "$SYS/root"; done

export SHROUDLY_SYSROOT_LINUX_ARM64="$SYS/root"
node "$ROOT/scripts/build-core-advanced.js" --cross

echo "linux arm64 advanced engine built"
