# Contributing

Bug reports, ideas and pull requests are welcome.

## Set up

```sh
npm install
npm run watch   # restarts on server changes
npm run desktop # the Electron app, from source
npm run dist    # build installers for this OS into dist/
npm test
npm run lint
npm run test:e2e      # real server and browser, no internet needed
npm run test:coverage:unit # unit coverage report
npm run test:coverage:e2e  # e2e coverage report
npm run test:coverage      # unit + e2e together, fails under 90% line coverage
```

Needs Node.js 24+ and `ffmpeg` on the path for the end-to-end tests. The browser tests drive Google Chrome (the H.264 video needs its codecs); set `CHROME_PATH` to a Chrome or Chromium binary if it is not installed. `npm install` points git at `.githooks`: lint and unit tests run before every commit, the combined coverage gate before every push (`--no-verify` skips them). The frontend is plain ES modules with no build step.

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

Releases are automatic. Every merge to `main` updates a release pull request with the next version and changelog. Merging that pull request tags the release, publishes the notes and pushes the container image to `ghcr.io/dodoflix/dodobox` and Docker Hub (`dodoflix/dodobox`). Docker Hub needs the `DOCKERHUB_USERNAME` (`dodoflix`) and `DOCKERHUB_TOKEN` (access token with read/write scope) repository secrets.

## Scope

See the [legal notice](LEGAL.md): changes that add services built to distribute infringing content, or that bundle copyrighted material, are declined.

## Reporting security problems

See [SECURITY.md](SECURITY.md).
