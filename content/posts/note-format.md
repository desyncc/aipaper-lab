---
title: A note format recovered from its own importer
date: 2026-11-05
summary: How a proprietary .note file works — tables, ZIP comments, importer gates, and the re-id pass — and the one place the decompiler lied to me.
status: draft
tags: [notewriter, file-format, android]
---

The Paper app on this tablet opens a `.note` file, and it opens one that I built. Not exported and
re-imported — *built*, by a Python function, from a list of pages and a page of strokes. The
tablet then shows it as an ordinary notebook with an ordinary thumbnail in the ordinary library.

Getting there did not require breaking anything. It required reading the app's **importer**: the
code that already accepts a `.note` from a share sheet, a USB stick or another device. An importer
is a specification written by the vendor and, crucially, one that fails loudly. Every rule below
was learned by asking it a question and watching it say no.

This is the story of that format, and of the one place where the decompiler told me something
confident and wrong.

## The container is a ZIP with opinions

A `.note` is a deflate ZIP. Nothing exotic. The opinions are in the details:

- Every entry carries the same JSON in its **ZIP entry comment**, not as a file inside the archive.
  The archive comment is empty.
- Entries are flat. The exporter de-duplicates by base name and silently skips files that are
  missing on disk, so a notebook can travel with its tables but without a thumbnail.
- A "table" is an entry whose name ends in a known suffix. **The importer matches by suffix only**,
  so the prefix is yours to choose — the real exporter builds it from the notebook's name.
- Tables are pretty-printed JSON, and the importer reads them line by line, concatenating without
  separators. Fine for JSON; fatal for a writer that emits newlines *inside* a string value.

That last pair is the whole trick, and it is small enough to show:

```python
import json, zipfile

HEADER = {"appVersion": "1.8.9", "dbVersion": 22, "packageName": "com.wisky.notewriter"}

def add(z, name, payload):
    zi = zipfile.ZipInfo(name)
    zi.comment = json.dumps(HEADER).encode("utf-8")   # per-entry comment, not a file
    zi.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(zi, json.dumps(payload, indent=2))
```

The header is doing real work. `packageName` must equal the importing app's package (the app will
happily refuse a notebook built by "another app"), and `dbVersion` must be at least 14 while the
current app writes 22. Get either wrong and the import returns a negative code rather than a
notebook: `-6` for a foreign or missing header, `-1` for a schema too old, `-5` for a missing file,
and so on.

## The tables

Nine suffixes are read, one is a write-only curiosity:

| Suffix | Body | Read on import? |
|---|---|---|
| `_HeaderInfo.json` | `{appVersion, dbVersion, packageName}` | yes — gates everything |
| `_NoteFileInfo.json` | the notebook row | yes — required |
| `_PageListFileInfo.json` | page rows, in order | yes |
| `_PageResource.json` | the layer rows (ink, text, images, marks…) | yes |
| `_NoteTemplateResource.json` | the notebook's template | yes |
| `_PageTemplateResource.json` | per-page templates | yes |
| `_FolderTreeFileInfo.json` | the folder path from the root | yes — recreates folders |
| `_FolderFileInfo.json` | parent folder | parsed, unused for placement |
| `_FolderTemplateResource.json` | a folder template | **written by the exporter, never read** |

Everything that is not a table is a file, and files are extracted only if the extension is on an
allowlist: `jpg jpeg png txt json bin pdf mp4`. Note what is on it — and that audio is `.mp4`,
because that is what the recorder writes, not `.mp3`, despite a `.mp3` constant existing in the
code. A stray `.mp3` in an archive is dropped without complaint.

## The importer rewrites everything

This is the part that makes the format interesting rather than merely annoying. An import is not a
copy. It is a **re-identification pass**, done in one database transaction:

1. It wipes its own import temp directory first. Two imports at once will eat each other's files.
2. It walks the folder tree, rejecting cycles, matching folders by *name* under the previous
   folder, recreating what is missing, and collapsing legacy default folders onto the user folder.
3. It gives **every** row a new id: notebook, each page, each resource. Resource ids are remapped,
   and audio pairs are re-linked through a nickname field. Page order is preserved; ids are not.
4. If a notebook with the same name and type already exists in the target folder, it becomes
   `Name (1)`, `Name (2)`, and so on.
5. It resets sync state on everything it created: empty cloud id, empty unique id, version 0,
   empty etag, no last-sync time, `syncState = 1` ("modified"), empty device id. The original
   `lastModifiedTime` is kept.
6. It renames files to the app's canonical names, using the *new* ids, and moves them into place.

Step 5 is the one with consequences. An imported notebook is deliberately **upload-eligible**: it
has never synced, so the next sync run treats it as a new notebook and pushes it. That is the
feature — import is how you get a notebook from another device into your account — and it is also
the reason a tool like mine has to be careful about which notebooks it creates and what it does
with them afterwards.

Those canonical names are where I got burned, so they deserve their own table:

| Layer | Canonical file name | Confidence |
|---|---|---|
| ink (writing) | `mainBmp_<the writing resource's own id>.png` | observed on the device |
| screenshot | `screenshotBmp_<page id>.png` | observed |
| thumbnail | `Thumbnail_<page id>.png` | observed |
| recognition path | `path_<nickname>.json`, nickname = the ink resource id | observed |
| recognition order | `order_<page id>.txt` (row only, no file) | observed |
| text | `text_<id>.txt` | decompile only — no such row exists on this tablet to check |
| mark (annotation) | four files sharing one token, `markRender_*`, `markPreview_*`, `markMask_*`, `markClip_*` | shape observed, mask/clip formats undecoded |

You do not have to pre-compute these. The importer looks each row up in the temp directory by its
**original** file name, then rewrites the row to the canonical one. A writer only has to keep rows
and archive entries consistent with each other.

## Where the decompiler lied

The importer's naming block was the first thing I wrote down, and it was wrong.

The decompiler flattened a chain of type tests into a series of `if (type != N)` blocks, printed
the chain **twice** with different polarities, and produced a naming rule that named the ink layer
after its *page*. It read plausibly. It was consistent with itself. It was inverted.

What caught it was not a cleverer decompile. It was the tablet's own data: an aggregate query over
the 2,784 pages of the owner's library asking a boolean per row — *does this file name contain that
row's page id, or its own resource id?* 2,784 out of 2,784 said "its own". Then a live import
confirmed it, and the rule about PDF notebooks having a different id scheme got the same treatment
(the decompile had that condition inverted too).

Two lessons, both cheap to apply and both already in my notes:

- A decompiler's **branch polarity is not evidence**. Names, constants, call targets and data flow
  are usable; *which branch is taken* is a hypothesis until something independent confirms it.
- The device's own aggregate data is the cheapest oracle you have. Counts and boolean predicates
  answer structural questions without reading a single byte of content.

## The pipeline is the vendor's own backup checklist

There is a second, better confirmation that the format description is complete. The app contains a
staged "copy pages from note A into note B" pipeline, used when you move a page between notebooks
or duplicate a notebook. Its stages are, in order:

```
fetch note → init copy → init migration → fetch page rows → fetch page template →
fetch page resources → insert page rows → insert templates → insert {writing, recognition path,
recognition order, screenshot, thumbnail, mark, text, insert-image, insert-pic} resources →
copy files → apply DB migrations → optionally delete source files
```

Read that list again: it is the vendor enumerating everything a page carries. If a backup or an
exporter misses one of those resource types, it is lossy, and now there is a citation for saying so.
The format's completeness is not my inference; it is the app's own refactoring.

That pipeline is also why "append to an existing notebook" is possible at all: import a one-page
note (creating a throwaway notebook), then ask the app to move that page into the target. The app
re-ids, renames files, copies tags, marks both notebooks modified — and deletes the emptied
throwaway — all with its own code. My tooling never writes a row the app did not write.

## Receipts

A format claim is worth what you can demonstrate. This one has:

- **170 offline tests** over the reader, the pre-flight checks and the DB view, ~99% line coverage;
- a **live import** that the app accepted on the first attempt, with the expected rows, the expected
  five resources per page, and the expected file names;
- an **append** (import, then move) that produced a target notebook with contiguous page order and
  every file present — including the three file-less `order_*` rows that are supposed to be
  file-less;
- a **fingerprint check**: every notebook and page row in the owner's library, id and modified time,
  before and after. 2,915 rows and 9,096 resources, identical both times. Nothing of the owner's
  was read, and nothing changed.

The last one is the test I care most about. A format description that only works on an empty device
is not a description of the format.

## What is still unknown {#open}

- **Audio re-import** has never been tried. The allowlist says `.mp4`; the recorder says `.mp4`;
  nothing else is verified.
- **The mark's mask and clip binaries** (`markMask_*`, `markClip_*`) are undecoded. One row exists
  on this tablet, which is not a sample size.
- **Appending into a notebook that has already synced** is untested on purpose. Everything I built
  is scoped to notebooks that have never left the device, because the app's own rule for "has been
  to the cloud" is `cloudId or version > 0 or lastSyncTime > 0`, and a purge that ignores it leaves
  an orphan in someone's account.
- **`text_<id>.txt`** is a decompile-only claim: no such resource exists on this tablet to check it
  against.

If you own an AiPaper and want to poke at any of these, the container and the gates above are the
whole starting point, and the app will tell you what it does not like.
