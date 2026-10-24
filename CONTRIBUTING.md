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
npm run test:coverage:unit # unit tests, fails under 90% line coverage
npm run test:coverage:e2e  # e2e specs, fails under 90% line coverage
npm run test:coverage      # both, one after the other
```

Needs Node.js 24+ and `ffmpeg` on the path for the end-to-end tests. The browser tests drive Google Chrome (the H.264 video needs its codecs); set `CHROME_PATH` to a Chrome or Chromium binary if it is not installed. `npm install` points git at `.githooks`: lint and unit tests run before every commit, both coverage gates before every push (`--no-verify` skips them). The frontend is plain ES modules with no build step.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/). Pull requests are squash merged and the PR title becomes the commit, so the title must follow the format:

```
feat: add playback speed memory
fix(player): keep scroll position when the menu redraws
docs: correct the environment variable table
```

`feat` bumps the minor version, `fix` the patch, and `feat!` or a `BREAKING CHANGE:` footer the major (minor while below 1.0). Other types (`docs`, `ci`, `chore`, `refactor`, `test`, `build`) do not release on their own.

Keep a pull request to one change. Add or update a test when behaviour changes, and update `docs/` when a user-visible behaviour or setting changes.

## Tests

- A behaviour change or a bug fix comes with a test, and a bug fix with one that fails without the fix.
- `test/*.test.js` are unit tests: one module, no browser, no network. `e2e/*.spec.js` run the real server with Chrome and answer every outside service from fixtures in `e2e/harness.js` (`stub()` replaces one host), so they pass offline. A new flow a viewer can take gets an e2e spec; logic with edge cases gets a unit test.
- Unit and e2e coverage are each measured separately and must each stay at 90% of lines (`npm run test:coverage:unit`, `npm run test:coverage:e2e`). New code arrives with its tests; do not lower a threshold or exclude a file to get under it. The only files left out of the measurement cannot run offline: `translate.js` and `translate-hq.js` (download translation models), `presence.js` (Discord), `net.js` (opens the browser) and `data.js` (exits the process on a bad data folder).
- When a test fails, suspect the code before the test. Fix the code, and change a test only when the test itself is wrong. Never skip, loosen or delete a test to make a run pass.
- Tests must be deterministic: wait for a condition rather than a fixed delay, give each test its own data folder and ports, and do not depend on the real network, clock or machine (GPU, installed encoders).
- Test names say the behaviour ("a download that finds no source is listed as failed"), not the function.

## Localized text

Every word the interface shows is written in English in the source and translated by exact match from `public/js/lang/strings.js`.

- A new or reworded visible string (text, `aria-label`, `placeholder`, `title`, `alt`, toasts, error messages shown to the viewer) needs a row in `strings.js` in English, Turkish, Spanish, French and German, and the same row at the same position in every `public/js/lang/extra-<code>.js`. Rewording English changes the key, so update the row everywhere.
- Text with a number or a name in it (`Season 3`, `24 min left`) goes in `PATTERNS` with one output per language and `$1` style groups, not as a row per value.
- Titles, names, file names and other data are not translated: mark them `translate="no"`.
- Do not build a sentence from pieces; one string, one row. Keep the word order the translation needs by translating the whole sentence.
- No cell may be empty. A word that is the same in a language (`Anime`) is still written out.
- `npm test` fails when a language is missing a row or a pattern group, so run it before pushing.
- Add a new interface language by listing it in `public/js/i18n.js`, adding its `extra-<code>.js` with a row for every entry, and adding it to the language picker.

## Releases

Releases are automatic. Every merge to `main` updates a release pull request with the next version and changelog. Merging that pull request tags the release, publishes the notes and pushes the container image to `ghcr.io/dodoflix/dodobox` and Docker Hub (`dodoflix/dodobox`). Docker Hub needs the `DOCKERHUB_USERNAME` (`dodoflix`) and `DOCKERHUB_TOKEN` (access token with read/write scope) repository secrets.

## Scope

See the [legal notice](LEGAL.md): changes that add services built to distribute infringing content, or that bundle copyrighted material, are declined.

## Reporting security problems

See [SECURITY.md](SECURITY.md).
