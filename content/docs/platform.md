---
title: Platform reference
summary: Layer-by-layer notes on a Viwoods AiPaper (SE03), firmware 3.15.15 — what runs where, what is stock, and what the vendor added.
---

A reference, not a narrative. Every row says how it was checked:

- **read** — read in a decompile or disassembly of the shipped artifact;
- **probed** — observed on the device, over root adb or a live hook;
- **strings** — a string table or a config file only. A lead, not proof.

Device: Viwoods AiPaper, `ro.eink.model=SE03`, firmware 3.15.15, Android 13 (API 33), MediaTek
MT8788, kernel 4.19. Everything below is version-specific. Firmware identifiers are quoted; serial
numbers, MAC addresses, account identifiers and key material are not.

## Boot, root, and why nothing has to be modified {#boot}

The build is `userdebug` signed with release keys, and `/system/xbin/su` (setuid, group `shell`)
ships inside the signed system image. Verified boot reports `green` and `dm-verity` is enforcing
while `adb shell su 0` works. **read + probed.**

| Fact | How |
|---|---|
| `ro.build.type=userdebug`, `ro.debuggable=1`, `ro.secure=1` | probed |
| `/system/xbin/su` is in the signed `/` image, not added later | read |
| Bootloader is locked; `oem_unlock_supported=1`, `sys.oem_unlock_allowed=0` | probed |
| The unlock confirm prompt has no volume-rockers to answer, so the bootloader also accepts a fastboot `oem key <token>` | read (`lk` disassembly) |
| The FRP "unlock allowed" flag is the last 4-byte word of the `frp` partition | read |

## Verified boot and the A/B layout {#avb}

AVB 1.2 across six `vbmeta*` partitions, all with flags `0` (hashtree and verification both
enabled). The active slot is `_b`; `super` holds `system`, `vendor` and `product` as dynamic
partitions behind device-mapper verity. Unlocking the bootloader permits `flags=2`, which is what
makes a modified system or a custom boot image bootable at all. **read + probed.**

## What the vendor added to `system_server` {#services}

| Component | What it does | How |
|---|---|---|
| `ENoteSettingService` (`binder: ENoteSetting`) | One privileged bridge used by every vendor app: system properties, NVRAM reads/writes, display mode/gamma/light-shade per package, screen-lock credentials, silent install/uninstall, app-data wipe, screenshot capture, key injection, task trimming | read + probed |
| `EnoteDeviceCheckService` | On every validated network, asks the vendor whether this device is blocked, and acts on the answer | read + probed |
| `PackageManagerShellCommand` | `adb install` / `uninstall` are gated on a build property; a matching persistent property unlocks them | read + probed |
| `LockSettingsService` | A credential change from anything but the vendor Settings app is refused and redirected | read |

The service is reachable from ordinary apps, and the SELinux policy allows it, so it is a
capability surface as much as a convenience layer. See the [audit post](/posts/audit/) for the
class of problem and the fix direction.

## The ink fast path {#ink-bus}

`surfaceflinger` on this device is not only the compositor. It hosts two additional binder
services and a large vendor transaction table. **read (disassembly) + probed.**

| Thing | Detail |
|---|---|
| `EinkMessageHandler` | ~70 transaction codes: power, refresh mode, refresh unit, VCOM set/get, waveform verify/install, panel batch, ghosting filter, and debug hooks including a grayscale frame dump |
| `WritingProducer` / `WritingConsumer` | A dedicated 1920×2560 buffer queue ("writing" gralloc usage). A stroke buffer arrives, a listener posts a private message to the compositor's looper, and the frame is converted to grayscale on the GPU, dithered, and pushed to the panel driver |
| Why it exists | The path does not wait on WindowManager composition or presentation fences. While the pen is down, full-screen refreshes are deferred; on pen-up, a high-quality grayscale refresh reconciles the background UI |

It is the single most interesting thing in the image: the vendor built a second, private display
pipeline for ink, and it is reachable from native code.

## Per-app display tuning {#profiles}

Each package can carry a refresh mode (four values), a gamma index, and a light-shade level,
stored in `Settings.Global` under package-derived keys and applied when an activity comes to the
front. **read + probed.**

Two details matter and are easy to get wrong: the service caches each package's values on first
lookup and never invalidates them (so writing `Settings.Global` behind its back does nothing until
the service restarts), and the write path that does work is the binder, not the settings table.

There is also a hook that is not in the Settings app at all: `/system/etc/note_config/` ships
per-app JSON that maps an app's view tree onto a write/annotate mode — root view, write view,
the view id that enters it, the pen/eraser view, the page view. **strings.** The consumer lives in
`framework.jar`; I have read the hook's strings and config schema, not its class.

## Waveforms {#waveform}

The panel's LUT ("waveform") is a file, not a firmware blob compiled into a driver. Twenty-three
of them ship in `/product/firmware/`, one per panel batch. **read + probed.**

- The factory file is chosen by an 8-character panel batch string stored in a raw partition.
- Installing a new one goes through three steps: a hash check, a privileged file swap, and a
  reload. The hash check passes a path plus a Base64 blob; the blob decrypts to a SHA-256 hex
  digest that must match the file. The key and IV for that decryption are constants in
  `surfaceflinger`. They are not reproduced here.
- The swap is done by `installd` as root, keeping the previous file as a backup, into a partition
  that a factory reset does not touch.

So a panel LUT is a user-replaceable artifact on this device, protected by a shared secret that
ships in the same binary as the checker. That is a design observation, not an exploit.

## The pen {#pen}

The digitizer is a Wacom W9013 on I²C-3 at address `0x09`, with its own 256 KB Cortex-M firmware
shipped as Intel HEX in `/product/firmware/`. A root daemon flashes it at boot when a newer image
is present, then updates the input device's reported firmware version. **read + probed.**

The MCU speaks a record protocol with a small queue, serves a standard 45-byte HID report
descriptor, and branches on 22 record types. The vector table, the IRQ gate, and the callback that
implements the protocol are mapped; the main loop and the meaning of the per-type fields are not.

## Persistent records {#proinfo}

A 3 MB raw partition holds a 1 KB `PRODUCT_INFO` record that every wipe and OTA leaves alone:
serial, MACs, board revision, build date, panel batch, panel serial, factory VCOM bias, QC flag,
and one byte that the device-check service treats as "locked". **read + probed.** Field offsets are
not reproduced here.

## Remote lock {#killswitch}

`EnoteDeviceCheckService` performs a blacklist query when a validated network appears. If the
answer is "blocked", it writes the flag byte into that persistent record, covers the screen with a
non-dismissible alert, and starts a five-minute countdown that ends in a forced shutdown. The flag
survives a factory reset, a data wipe and an OTA. **read + probed.**

The class of problem: a single server response, keyed on a device identifier, can permanently
disable hardware the owner paid for, with no offline path to dispute it and no recovery that the
owner controls. The fix direction is a vendor decision (an owner-visible, revocable state with a
local override, or no remote lock at all), not something a user is supposed to work around.

## Signing keys {#signing-key}

The Files app and `framework-res` are signed with **AOSP's public test platform key**, while the
build advertises `release-keys`. Several `/product` apps share `android.uid.system`. **read +
probed.**

Consequence: a rebuilt `/product` app can be signed with the same public key and installed as an
update, keeping the system UID and signature-level permissions. The class of problem is signing
with a key that is public by construction; the fix is to re-sign the build with private release
keys. I am not publishing a rebuilt app.

## What is deliberately not here {#limits}

No vendor binaries, APKs, dex or decompiled trees. No key material, tokens, serials, MAC
addresses or captures. No note content. No working exploit, and no step-by-step procedure for
anything with a security consequence — those are described by class and fix direction only.

If you own one of these tablets and want to compare notes, the interesting open questions are in
[the last post](/posts/note-format/#open).
