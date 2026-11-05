# AiPaper Lab

Research notes on a **Viwoods AiPaper** — a 10.3″, Android 13 e-ink tablet with a pen, a
proprietary notebook format, a vendor display stack, and more undocumented privilege than it
should have.

This repository holds the public half: a small static site, a layer-by-layer reference, and
write-ups. The evidence ledger behind it — annotated decompiles, live probes, captures, the
firmware snapshot — stays private, because it contains vendor binaries, key material and one
person's notebooks.

**Site:** <https://damagedpatches.dev> (build target; adjust the domain in `astro.config.mjs`).

## Start here

| Page | What it is |
|---|---|
| [`content/docs/platform.md`](content/docs/platform.md) | The reference: boot, root, system services, the ink pipeline, waveforms, the pen, the calibration record, remote lock. Every row carries an evidence label. |
| [`content/posts/note-format.md`](content/posts/note-format.md) | How a `.note` file works — recovered from the app's own importer, including the two places a decompiler lied. |
| [`content/posts/audit.md`](content/posts/audit.md) | The security write-up: class of problem and fix direction. No proof of concept, no key material. |
| `src/pages/ten.astro` | Ten claims that make people say "wait, what". |

## How claims are labelled

- **read** — read in a decompile or disassembly of a shipped artifact
- **probed** — observed on the device (root adb, live hook)
- **strings** — a string table or config file only; a lead, not proof

A claim with no label is an opinion, and this repo tries not to have those.

## What is published here, and what is not

Published: architecture, class and method names, format rules, transaction tables, aggregate counts,
diagrams, evidence labels.

Not published: vendor binaries, APKs, dex or decompiled trees; key material, tokens, serial numbers,
MAC addresses or captures; note content; working exploits or step-by-step procedures with a security
consequence. If you are the vendor and want the detail behind a finding, ask.

## Running the site

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Posts live in `content/posts/*.md` and reference docs in `content/docs/*.md`, so they read as plain
markdown on GitHub as well as rendering on the site. A post is invisible to the build until its
frontmatter says `status: published`; drafts render with a chip and a `noindex` tag.

## Licence

Text and diagrams: CC BY 4.0. Code samples in the posts and the site source: MIT. See
[`LICENSE.md`](LICENSE.md).

## Disclaimer

Unofficial fan research on a device I bought and own. Not made by, affiliated with, or endorsed by
Viwoods or Wisky. Product names are used descriptively. Nothing here is advice — if you modify your
own device, that is your device and your warranty.
