# Contributing

Bug reports, ideas and pull requests are welcome.

## Set up

```sh
npm install
npm run watch   # restarts on server changes
npm test
npm run lint
```

Needs Node.js 22+ and `ffmpeg` on the path for the end-to-end test. The frontend is plain ES modules with no build step.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/). Pull requests are squash merged and the PR title becomes the commit, so the title must follow the format:

```
feat: add playback speed memory
fix(player): keep scroll position when the menu redraws
docs: correct the environment variable table
```

`feat` bumps the minor version, `fix` the patch, and `feat!` or a `BREAKING CHANGE:` footer the major (minor while below 1.0). Other types (`docs`, `ci`, `chore`, `refactor`, `test`, `build`) do not release on their own.

Keep a pull request to one change. Add or update a test when behaviour changes, and update `docs/` when a user-visible behaviour or setting changes.

## Releases

Releases are automatic. Every merge to `main` updates a release pull request with the next version and changelog. Merging that pull request tags the release, publishes the notes and pushes the container image to `ghcr.io/dodoflix/dodobox`.

## Reporting security problems

See [SECURITY.md](SECURITY.md).
