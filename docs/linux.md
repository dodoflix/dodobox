# Installing on Linux

Each release publishes an AppImage, a `.deb` and an `.rpm`, plus apt and dnf repositories and an AUR package so updates arrive through the package manager.

## Debian, Ubuntu

```sh
sudo curl -fsSL https://dodoflix.github.io/dodobox/key.asc -o /etc/apt/keyrings/dodobox.asc
echo 'deb [signed-by=/etc/apt/keyrings/dodobox.asc] https://dodoflix.github.io/dodobox/apt ./' | sudo tee /etc/apt/sources.list.d/dodobox.list
sudo apt update && sudo apt install dodobox
```

## Fedora, RHEL, openSUSE

```sh
sudo curl -fsSL https://dodoflix.github.io/dodobox/rpm/dodobox.repo -o /etc/yum.repos.d/dodobox.repo
sudo dnf install dodobox
```

On openSUSE: `sudo zypper addrepo https://dodoflix.github.io/dodobox/rpm/dodobox.repo && sudo zypper install dodobox`.

## Arch, CachyOS, Manjaro

```sh
yay -S dodobox-bin
```

## Verifying a download

Every release carries `SHA256SUMS`, signed with the repository key (`key.asc` above), and a build provenance attestation for each file.

```sh
curl -fsSLO https://dodoflix.github.io/dodobox/key.asc && gpg --import key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS && sha256sum -c --ignore-missing SHA256SUMS
gh attestation verify Dodobox-*.deb --repo dodoflix/dodobox
```

The Windows and macOS installers are not code signed yet. They are covered by the checksums and attestations above.
