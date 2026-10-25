#!/bin/sh
# Publishes the release deb as an AUR -bin package.
# Usage: AUR_SSH_PRIVATE_KEY=... TAG=v1.2.3 publish-aur.sh <PKGBUILD.in> <package> <deb>
set -eu

tpl=$1 pkg=$2 deb=$3
ver=${TAG#v}
# https://wiki.archlinux.org/title/AUR_submission_guidelines#Authentication
aur_fp='SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4'

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sum=$(sha256sum "$deb" | cut -d' ' -f1)
mkdir "$work/pkg"
sed -e "s/@VERSION@/$ver/" -e "s/@SHA256@/$sum/" "$tpl" > "$work/pkg/PKGBUILD"

# .SRCINFO comes from makepkg, so it needs Arch; makepkg refuses to run as root.
docker run --rm -v "$work/pkg:/pkg" archlinux:base-devel sh -c '
  useradd -m builder && chown -R builder /pkg
  su builder -c "cd /pkg && makepkg --printsrcinfo > .SRCINFO"'

umask 077
mkdir -p "$work/ssh"
printf '%s\n' "$AUR_SSH_PRIVATE_KEY" > "$work/ssh/id"
ssh-keyscan -t ed25519 aur.archlinux.org > "$work/ssh/known_hosts" 2>/dev/null
[ "$(ssh-keygen -lf "$work/ssh/known_hosts" | cut -d' ' -f2)" = "$aur_fp" ] \
  || { echo "unexpected AUR host key" >&2; exit 1; }
export GIT_SSH_COMMAND="ssh -i $work/ssh/id -o IdentitiesOnly=yes -o UserKnownHostsFile=$work/ssh/known_hosts"

git clone "ssh://aur@aur.archlinux.org/$pkg.git" "$work/repo"
cp "$work"/pkg/PKGBUILD "$work"/pkg/.SRCINFO "$work/repo/"
cd "$work/repo"
git add PKGBUILD .SRCINFO
if git diff --cached --quiet; then echo "$pkg $ver is already on the AUR"; exit 0; fi
git -c user.name=github-actions -c user.email=41898282+github-actions[bot]@users.noreply.github.com \
  commit -m "Update to $ver"
git push origin HEAD:master
