# Code signing policy

**Status:** Windows installers are being set up for signing by the SignPath Foundation. Until a release says it is signed, Windows shows its usual warning (see [Using Dodobox](usage.md#desktop-app)). macOS and Linux builds are not signed: Apple's signing needs a paid membership, and Linux does not require it.

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

The Windows setup and portable `.exe` files, built by the [release workflow](../.github/workflows/release.yml) from the tagged commit on GitHub-hosted runners. The signing request is made from that workflow, SignPath checks it came from this repository, and a person approves each one. Nothing else is signed, and nothing is built or signed from a developer's computer.

## Team

- **Authors**: maintainers with write access to [dodoflix/dodobox](https://github.com/dodoflix/dodobox).
- **Reviewers**: maintainers who review pull requests from people without write access.
- **Approvers**: the repository owner, [dodoflix](https://github.com/dodoflix), approves every signing request.

Everyone with these roles uses multi-factor authentication on GitHub and SignPath.

## Privacy

Dodobox runs on your own computer. It has no accounts and sends no telemetry or analytics. It contacts other services only to do what you ask:

- catalog and artwork services, to show titles;
- subtitle services, when you open the subtitle menu;
- torrent search services, and trackers and peers, when you play or download something;
- a public list of torrent trackers, and the translation models for subtitles (downloaded once);
- a speed test when it starts (`NO_SPEEDTEST=1` turns it off);
- GitHub, to look for a newer release (`NO_UPDATE_CHECK=1` turns it off).

Nothing about you is sent beyond what those requests need (your IP address, and the title being looked up). Your profiles, history and files stay in your data folder.

## Installing and removing

The Windows installer can be removed in Settings, Apps. The portable file needs no install: delete it. Your data stays in the app's folder for your user until you delete it.

## For maintainers

Signing is off until the repository variable `SIGNPATH_ORGANIZATION_ID` and the secret `SIGNPATH_API_TOKEN` are set; releases build and attach unsigned installers as before.

1. Apply at [signpath.org/apply.html](https://signpath.org/apply.html) once the project meets the [terms](https://signpath.org/terms): OSI license, released in the form to be signed, this policy linked from the README.
2. In SignPath, create the project `dodobox`, link the GitHub.com trusted build system, and add the signing policy `release-signing` with manual approval.
3. Artifact configuration (a zip with the two installers at its root, metadata restricted to product name `Dodobox`):

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Dodobox-Setup-*.exe"><authenticode-sign/></pe-file>
       <pe-file path="Dodobox-Portable-*.exe"><authenticode-sign/></pe-file>
     </zip-file>
   </artifact-configuration>
   ```

4. Add the variable and the secret in the repository settings.
5. After the first signed release, set `win.publisherName` in `package.json` to the signer's name so the updater also checks who signed what it downloads, and drop the Status paragraph above.

After signing, `.github/scripts/refresh-update-yml.mjs` rewrites `latest.yml` with the signed files' checksums, which the installed app compares against. A new certificate may still trigger SmartScreen until it has built reputation.
