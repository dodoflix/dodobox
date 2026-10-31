#!/bin/sh
# Builds signed apt and dnf repositories from the .deb and .rpm files in <assets> into <site>.
# Needs apt-utils and createrepo-c, and the signing key in the gpg keyring.
# Usage: GPG_PASSPHRASE=... GITHUB_REPOSITORY=owner/repo linux-repos.sh <assets> <site>
set -eu

assets=$1 site=$2
name=${GITHUB_REPOSITORY#*/}
base="https://${GITHUB_REPOSITORY%/*}.github.io/$name"

sign() { gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" "$@"; }

mkdir -p "$site/apt" "$site/rpm"
cp "$assets"/*.deb "$site/apt/"
cp "$assets"/*.rpm "$site/rpm/"
gpg --armor --export > "$site/key.asc"

# Flat apt repository: `deb [signed-by=...] <base>/apt ./`
(
  cd "$site/apt"
  apt-ftparchive packages . > Packages
  gzip -k Packages
  # Written outside the directory so the Release file does not list itself.
  apt-ftparchive -o "APT::FTPArchive::Release::Origin=$name" release . > ../Release.tmp
  mv ../Release.tmp Release
  sign --clearsign -o InRelease Release
  sign --armor --detach-sign -o Release.gpg Release
)

createrepo_c --quiet "$site/rpm"
sign --armor --detach-sign "$site/rpm/repodata/repomd.xml"
cat > "$site/rpm/$name.repo" <<REPO
[$name]
name=$name
baseurl=$base/rpm
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=$base/key.asc
REPO
