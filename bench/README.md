# Backend benchmarks

Measures the pieces behind "find something to play": torrent sources, release-name matching, file choice inside a pack,
ranking, lookup orchestration, title search and id mapping. Nothing here ships with the app.

```sh
npm run bench -- data                  # one-time: Fribb id lists and ani.zip episode tables (cached in bench/.cache)
npm run bench -- match                 # offline, uses snapshots/: release matchers
npm run bench -- pick                  # offline: file choice in packs
npm run bench -- sources --set core    # network: ask every source about the gold titles
npm run bench -- coverage --set core   # report on the stored answers
```

Optional third-party matchers for `match`: `npm --prefix bench install`.

Commands, methodology, results and how to extend: [docs/benchmarks.md](../docs/benchmarks.md).
What the results mean for the backend: [docs/backend-plan.md](../docs/backend-plan.md).
