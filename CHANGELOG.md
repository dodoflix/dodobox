# Changelog

## [0.9.0](https://github.com/dodoflix/dodobox/compare/v0.8.0...v0.9.0) (2026-10-24)


### Features

* incremental subtitle sync that builds on earlier windows as the download grows ([#62](https://github.com/dodoflix/dodobox/issues/62)) ([47cb4f3](https://github.com/dodoflix/dodobox/commit/47cb4f3fe59c940680c2a289448b05c9e9c37fd1))
* let each profile connect its own OpenSubtitles VIP account for subtitle downloads ([#55](https://github.com/dodoflix/dodobox/issues/55)) ([550b05f](https://github.com/dodoflix/dodobox/commit/550b05fb89a0cd4b2834755d021e659f12879ae2))
* log requests, torrents, ffmpeg, and page errors to a file in the data folder ([#48](https://github.com/dodoflix/dodobox/issues/48)) ([6372227](https://github.com/dodoflix/dodobox/commit/637222794702bbe2bea3bd3bd24b98dabcdfe005))
* measure subtitle timing against the video's built-in text track ([#63](https://github.com/dodoflix/dodobox/issues/63)) ([cd4a460](https://github.com/dodoflix/dodobox/commit/cd4a46088fbd2763c755d0667fc60428f3beb764))
* pick releases the line can carry on slow and distant connections ([#52](https://github.com/dodoflix/dodobox/issues/52)) ([a112264](https://github.com/dodoflix/dodobox/commit/a1122640d645e751dbc8518a2a9329999d39426d))
* rank subtitles by release match, hearing-impaired, frame rate, rating and uploader ([#51](https://github.com/dodoflix/dodobox/issues/51)) ([b39aeda](https://github.com/dodoflix/dodobox/commit/b39aeda5f35507b819e7fe743a484cd002cd452c))
* re-sync button in the subtitle menu ([#61](https://github.com/dodoflix/dodobox/issues/61)) ([e90438f](https://github.com/dodoflix/dodobox/commit/e90438f605f2e03fb1560fa20dd8be3b95a254ac))
* warn when forced quality or download size will not run on a slow connection ([#67](https://github.com/dodoflix/dodobox/issues/67)) ([e5fa13a](https://github.com/dodoflix/dodobox/commit/e5fa13ab1d93e64836782f6679ed46df9e77c880))


### Bug fixes

* anime subtitle lookup by TVDB numbering, drop films and specials ([#66](https://github.com/dodoflix/dodobox/issues/66)) ([3e54bd0](https://github.com/dodoflix/dodobox/commit/3e54bd0b5e136481e9903077d6d81e1095dda64e))
* ask for the PIN when the saved session is no longer valid ([#50](https://github.com/dodoflix/dodobox/issues/50)) ([548ef62](https://github.com/dodoflix/dodobox/commit/548ef62df542df05ddb0ac4883f65e212994e2f2))
* downloads race versions like play, show progress at once, hide racing copies ([#54](https://github.com/dodoflix/dodobox/issues/54)) ([c3cd6f0](https://github.com/dodoflix/dodobox/commit/c3cd6f048005849150af409a664f00a23e8265ce))
* find subtitles for anime cours filed as their own show ([#69](https://github.com/dodoflix/dodobox/issues/69)) ([f848d54](https://github.com/dodoflix/dodobox/commit/f848d54c6b93f927f3525e52a69e992e5ce272e4))
* handle OpenSubtitles download quota, sort subtitles by rank, keep best match visible ([#53](https://github.com/dodoflix/dodobox/issues/53)) ([99734ec](https://github.com/dodoflix/dodobox/commit/99734ece73e8229fea7082289d17493c651133ef))
* initial subtitle sync ran as a single-window probe in the worker ([#60](https://github.com/dodoflix/dodobox/issues/60)) ([f7cd6ef](https://github.com/dodoflix/dodobox/commit/f7cd6ef10b0fcff86b8f82c1530f4984bae9b32c))
* only warn about missing torrent peers when no source supplied any ([#65](https://github.com/dodoflix/dodobox/issues/65)) ([64243c1](https://github.com/dodoflix/dodobox/commit/64243c13455e54a7c62aca86979d414fb4c8c052))
* remove ad cues from served subtitles ([#64](https://github.com/dodoflix/dodobox/issues/64)) ([58cbbf2](https://github.com/dodoflix/dodobox/commit/58cbbf2ef3c9a883822a940552b4eff74c33332a))
* single Download Dodobox button in Discord presence linking to the latest release ([#70](https://github.com/dodoflix/dodobox/issues/70)) ([25da36d](https://github.com/dodoflix/dodobox/commit/25da36db28e276c0f5a1dd10781466d83c8649f6))
* subtitle sync on resume, keep sync and timing per episode, benchmark window size ([#59](https://github.com/dodoflix/dodobox/issues/59)) ([93cdcfe](https://github.com/dodoflix/dodobox/commit/93cdcfe49e2eca103c0cd6909f65cabee081fa92))

## [0.8.0](https://github.com/dodoflix/dodobox/compare/v0.7.0...v0.8.0) (2026-10-18)


### Features

* adult filter covers movies, series and personal lists, sukebei sources for adult anime ([#41](https://github.com/dodoflix/dodobox/issues/41)) ([0cc0e82](https://github.com/dodoflix/dodobox/commit/0cc0e82fd76b520cbf021df104e88f706e193226))
* download controls, history removal, player stats and fixes ([#42](https://github.com/dodoflix/dodobox/issues/42)) ([f4fc910](https://github.com/dodoflix/dodobox/commit/f4fc910439c9634a4b3c73b0e28a5c786860ac7b))
* optional watch party password and security hardening ([#37](https://github.com/dodoflix/dodobox/issues/37)) ([c9596b5](https://github.com/dodoflix/dodobox/commit/c9596b50882474d6c76d717056cc2ae6fa84a470))
* preview and detail info, scroll arrows on strips, rounded posters ([#40](https://github.com/dodoflix/dodobox/issues/40)) ([2992823](https://github.com/dodoflix/dodobox/commit/2992823a49bf4010f2e0f33becc56ddd287a7b5f))
* profile PINs, asked in setup, and setup split into three pages ([#46](https://github.com/dodoflix/dodobox/issues/46)) ([e5ce0de](https://github.com/dodoflix/dodobox/commit/e5ce0de70d64d1c7f6b41d7ce2dfe4870cfff03b))
* skip intro and recap, up next at the credits ([#43](https://github.com/dodoflix/dodobox/issues/43)) ([1efa6fa](https://github.com/dodoflix/dodobox/commit/1efa6fadce7c354d240bf1c01e44cd4e3d61f2db))
* watch party shows how many people are in and the limit ([#45](https://github.com/dodoflix/dodobox/issues/45)) ([0d5b23d](https://github.com/dodoflix/dodobox/commit/0d5b23d907a7a2cd7e0baaef4898026cc841eed4))


### Bug fixes

* settings columns share the whole page width ([#44](https://github.com/dodoflix/dodobox/issues/44)) ([1fc5799](https://github.com/dodoflix/dodobox/commit/1fc5799c91c9330e1b293386f7728266ca16c1e3))
* squarer controls matching text inputs, centred switch knob, dropdown and detail layout fixes ([#39](https://github.com/dodoflix/dodobox/issues/39)) ([a9091c2](https://github.com/dodoflix/dodobox/commit/a9091c2f7216630f1d75ee0f950cdb6c1d35b15e))


### Documentation

* refresh README banner screenshots ([#47](https://github.com/dodoflix/dodobox/issues/47)) ([d30a463](https://github.com/dodoflix/dodobox/commit/d30a463600935e27a8cb32882438d9a3e9f75ea4))

## [0.7.0](https://github.com/dodoflix/dodobox/compare/v0.6.0...v0.7.0) (2026-10-16)


### Features

* Discord Rich Presence while something plays ([#33](https://github.com/dodoflix/dodobox/issues/33)) ([db15c32](https://github.com/dodoflix/dodobox/commit/db15c32fe2746f8b7bd920a76a7fd55e2be0e427))


### Bug fixes

* Discord presence text follows the interface language ([#35](https://github.com/dodoflix/dodobox/issues/35)) ([82c1e8e](https://github.com/dodoflix/dodobox/commit/82c1e8ea2532a90b5e2169706f927db5a23def22))

## [0.6.0](https://github.com/dodoflix/dodobox/compare/v0.5.0...v0.6.0) (2026-10-16)


### Features

* watch party chat with emoji, reactions and activity lines ([#30](https://github.com/dodoflix/dodobox/issues/30)) ([e0547dc](https://github.com/dodoflix/dodobox/commit/e0547dca32bda2d1f7dac326777f92b004c68b31))


### Documentation

* add a screenshot banner to the README ([#32](https://github.com/dodoflix/dodobox/issues/32)) ([8dbed79](https://github.com/dodoflix/dodobox/commit/8dbed79edba54b1680f659b155cb3fb42c5dcfd4))

## [0.5.0](https://github.com/dodoflix/dodobox/compare/v0.4.0...v0.5.0) (2026-10-16)


### Features

* id-first source discovery, one release parser, backend benchmarks ([#28](https://github.com/dodoflix/dodobox/issues/28)) ([853a5a6](https://github.com/dodoflix/dodobox/commit/853a5a6973a5b8f89f3226d73972d109534a8955))

## [0.4.0](https://github.com/dodoflix/dodobox/compare/v0.3.0...v0.4.0) (2026-10-15)


### Features

* search without leaving the page, hero progress bars, episode ranges ([#24](https://github.com/dodoflix/dodobox/issues/24)) ([565dad7](https://github.com/dodoflix/dodobox/commit/565dad7002f68d11a994042575b9b55e757e043f))
* watch party over the torrent network ([#21](https://github.com/dodoflix/dodobox/issues/21)) ([b31ecd7](https://github.com/dodoflix/dodobox/commit/b31ecd7637c749fbd349194f06f49a6d31ec3ca8))


### Bug fixes

* hardware encoder fails on 1440p and 2160p, fall back to the processor ([#22](https://github.com/dodoflix/dodobox/issues/22)) ([8acb5a8](https://github.com/dodoflix/dodobox/commit/8acb5a84a48d69a40c95fa067ab3b36a598226de))
* ship standard-size Linux icons ([#18](https://github.com/dodoflix/dodobox/issues/18)) ([419413c](https://github.com/dodoflix/dodobox/commit/419413c9bad6eca1c2cccae73399ba240617f204))


### Performance

* render only what is on screen, disable text selection ([#25](https://github.com/dodoflix/dodobox/issues/25)) ([74efb6b](https://github.com/dodoflix/dodobox/commit/74efb6bef2dafd9fbf58cb22050d73df86e2e8ba))
* smaller desktop releases, no separate ffprobe ([#20](https://github.com/dodoflix/dodobox/issues/20)) ([e53b09a](https://github.com/dodoflix/dodobox/commit/e53b09a7d4d64afc8407449d2a03a64d7f3a30a3))

## [0.3.0](https://github.com/dodoflix/dodobox/compare/v0.2.0...v0.3.0) (2026-10-15)


### Features

* use subtitle files beside local videos, say when a language is missing ([#15](https://github.com/dodoflix/dodobox/issues/15)) ([36ae92a](https://github.com/dodoflix/dodobox/commit/36ae92ab3e6cfa9ff18bc8c4b89579deed7a1034))
* use subtitle files that come inside the torrent ([#13](https://github.com/dodoflix/dodobox/issues/13)) ([ffc7cd1](https://github.com/dodoflix/dodobox/commit/ffc7cd124e6cfb23cda325e3491b645b2d7dfa25))
* version the data folder and browser storage, migrate on upgrade ([#17](https://github.com/dodoflix/dodobox/issues/17)) ([5e075d7](https://github.com/dodoflix/dodobox/commit/5e075d73276c0e71c6d0bb15d75d0cf6609729d6))


### Bug fixes

* find subtitles for late episodes of long anime ([#12](https://github.com/dodoflix/dodobox/issues/12)) ([83ed80a](https://github.com/dodoflix/dodobox/commit/83ed80a09744a59aba4208f69a43388112eb10d4))
* translate library rows, time left and episode codes ([#16](https://github.com/dodoflix/dodobox/issues/16)) ([ee0a6a9](https://github.com/dodoflix/dodobox/commit/ee0a6a9f35e5bcc5b9fe5954fefd208895a49f22))
* update check on unsigned desktop builds, missing translations ([#11](https://github.com/dodoflix/dodobox/issues/11)) ([28b9383](https://github.com/dodoflix/dodobox/commit/28b938307cca9d965aa98ab88e28aaf04f5197c1))

## [0.2.0](https://github.com/dodoflix/dodobox/compare/v0.1.0...v0.2.0) (2026-10-15)


### Features

* update notices with one-click desktop update, and fewer requests ([#10](https://github.com/dodoflix/dodobox/issues/10)) ([2b6bfda](https://github.com/dodoflix/dodobox/commit/2b6bfda3b937ddaf3cad170514f85ded82cff955))


### Bug fixes

* redraw the app icon and add a monochrome menu-bar glyph ([#7](https://github.com/dodoflix/dodobox/issues/7)) ([b2a11db](https://github.com/dodoflix/dodobox/commit/b2a11db8d7d480e2cca9b18b64961c84ab0f9aed))


### Performance

* faster, lighter loading on slow links ([#8](https://github.com/dodoflix/dodobox/issues/8)) ([f77bb7f](https://github.com/dodoflix/dodobox/commit/f77bb7fb0a661aea878a1deafda5522cde3085e7))

## 0.1.0 (2026-10-15)


### Features

* add a tray desktop app with installers for Windows, macOS and Linux ([#6](https://github.com/dodoflix/dodobox/issues/6)) ([09b4916](https://github.com/dodoflix/dodobox/commit/09b49163419253ab6bbd7663ea64ac8060738412))
* add streaming server and web app ([e53e282](https://github.com/dodoflix/dodobox/commit/e53e28273d5a4e7e939038a4de98c6007cea0694))


### Documentation

* add readme, license, policies and contributor guide ([619bdd6](https://github.com/dodoflix/dodobox/commit/619bdd65c286c4e19b8f0924a023be8748a154d1))
* shorten the guides and add a legal notice ([5bd33ce](https://github.com/dodoflix/dodobox/commit/5bd33cee94360dbacd2c6ae19bdcaba6544244a1))
