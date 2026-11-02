# Third-party notices

Dodobox itself is under the [MIT license](LICENSE). It bundles or downloads the software below, which is under its own terms. This file ships in the desktop installers and the container images.

## ffmpeg (GPL-3.0-or-later)

Desktop installers and the container images include a static `ffmpeg` binary that the [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) npm package downloads at install time (its release `b6.1.1`) for the platform being built. `ffmpeg-static` only mirrors builds made by others: Linux (container images, `.deb`, AppImage) by [John Van Sickle](https://johnvansickle.com/ffmpeg/), Windows by [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), macOS by [evermeet.cx](https://evermeet.cx/ffmpeg/) (Intel) and [osxexperts.net](https://osxexperts.net/) (Apple silicon). Those builds include GPL components (libx264 and libx265 among them), so ffmpeg is distributed under the **GNU General Public License, version 3 or later**. Dodobox only starts it as a separate program; it does not link to it, and the rest of Dodobox stays under the MIT license.

- **Licence text:** `node_modules/ffmpeg-static/ffmpeg.LICENSE` (installed next to the binary in `resources/app/node_modules/ffmpeg-static/` in the desktop app and `/app/node_modules/ffmpeg-static/` in the container), or <https://www.gnu.org/licenses/gpl-3.0.txt>.
- **Build configuration and library versions:** `ffmpeg.README` in the same folder is the builder's own description of the binary (the ffmpeg version and the libraries it was built with), and `ffmpeg -version` prints the configure line.
- **Corresponding source:** ffmpeg itself is at <https://ffmpeg.org/download.html> (<https://git.ffmpeg.org/ffmpeg.git>). Each builder publishes the source of its builds: Linux at <https://johnvansickle.com/ffmpeg/release-source>, Windows as the ffmpeg commit named on <https://www.gyan.dev/ffmpeg/builds/> for the version in `ffmpeg.README`, macOS on the pages linked above. The libraries named in `ffmpeg.README` are open source and published by their authors. The binaries that were mirrored are at <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1>.
- **Written offer:** for three years after you receive Dodobox, you can get the complete corresponding source of the bundled ffmpeg by opening an issue at <https://github.com/dodoflix/dodobox/issues> titled "ffmpeg source request". Nothing is charged beyond the cost of the media if one is needed.
- **Use your own build instead:** set `FFMPEG` to the path of any ffmpeg (see [usage](docs/usage.md)); a system install is used when present.

ffmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. Dodobox is not affiliated with it.

## Subtitle translation (MPL-2.0)

[`@browsermt/bergamot-translator`](https://github.com/browsermt/bergamot-translator) (MPL-2.0) is bundled as a dependency. The translation models are not bundled: each is downloaded on first use from the public Firefox Translations registry and kept in the data folder. They are published by Mozilla under the Mozilla Public License 2.0 (see the registry record of each model).

## npm dependencies

Every other runtime dependency is listed in `package.json` and carries its own licence file inside its folder in `node_modules`.
