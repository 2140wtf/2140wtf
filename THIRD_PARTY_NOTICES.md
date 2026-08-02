# Third-party notices

2140.wtf includes and distributes third-party software and assets. Each item
remains subject to its own license. This file supplements, and does not replace,
the notices retained in source files and package distributions.

## Shakespeare / Ditto

The original application was created with Shakespeare as Mew and subsequently
developed as Ditto by Alex Gleason and other contributors. The inherited work is
licensed under GNU AGPL version 3. Its authorship is preserved in Git history.

## Soapbox Armada

Portions of the Concord V2 encrypted-community, chat, wallet-settings, and
wire-sync implementation were adapted from Soapbox Armada:

https://gitlab.com/soapbox-pub/armada

Armada is licensed under GNU AGPL version 3. The 2140.wtf adaptations and later
modifications are identified in this repository's Git history.

## Buzz artwork

The Bumble, Fizz, and Honey artwork under `public/pets/buzz/` is derived from
Buzz by Block, Inc.:

https://github.com/block/buzz

Copyright Block, Inc. Licensed under Apache License 2.0. See
`LICENSES/Buzz-Apache-2.0.txt`. Apache-2.0 does not grant a trademark licence,
and no endorsement by Block, Inc. is implied.

## Noble and Scure libraries

The standalone `public/bao-agent.mjs` and `public/bao-chat-mcp.mjs` bundles
include code from `@noble/hashes`, `@noble/curves`, `@noble/ciphers`, and
`@scure/base`.

- Noble Hashes, Noble Curves, and Scure Base: copyright Paul Miller.
- Noble Ciphers: copyright Paul Miller and Thomas Pornin.

These components are licensed under the MIT License. See
`LICENSES/Noble-Scure-MIT.txt` and `LICENSES/Noble-Ciphers-MIT.txt`.

## Package dependencies

JavaScript dependencies retain the copyright and license metadata shipped in
their packages. `package.json` and `package-lock.json` identify the exact
dependency graph used to build a release. Redistributors must preserve the
notices required by those packages.
