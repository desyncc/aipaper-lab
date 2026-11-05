---
title: An audit, by class of problem and fix direction
date: 2026-11-05
summary: What a locked-down, single-owner e-ink tablet gets wrong about privilege, secrets and remote control — described so it can be fixed, not used.
status: draft
tags: [android, security, audit]
---

**Status: not yet reported to the vendor.** This is my own device, I am not publishing a proof of
concept, and I am not publishing key material, identifiers or step-by-step procedures. What follows
is the class of each problem, its impact, and the direction of the fix — which is the part a vendor
can actually act on.

Three of these are ordinary Android mistakes. Two are architectural choices that are harder to undo.
The last one is the reason I would not recommend this device to someone who needs it to keep working
for a decade.

## The short version

| # | Class of problem | Impact | Fix direction |
|---|---|---|---|
| 1 | Privileged binder service with no caller check | Any installed app can act as `system_server` | Enforce a signature-level permission *before* dropping the caller identity |
| 2 | Plaintext credential in a system property (and in logcat) | A lock screen becomes decorative | Never persist the credential; use the platform's synthetic-password flow |
| 3 | Exported provider that opens an arbitrary path | Any app reads any file the vendor app can | Remove the provider, or verify the caller and the path |
| 4 | Sensitive provider behind a `normal`-level permission | Any app can read or overwrite it by declaring the permission | Raise to `signature` |
| 5 | TLS verification disabled in the HTTP client | Active interception of updates and login | Delete the trust-all manager and verifier |
| 6 | Shared secrets compiled into the client | Checks that only look like checks | Asymmetric signatures, or nothing |
| 7 | Product apps signed with AOSP's public test key | A rebuilt system app can keep the system UID | Re-sign the build with private release keys |
| 8 | Remote disable keyed on a device identifier, persisted outside every wipe | A server response can permanently brick hardware | Owner-visible, revocable state; or no remote lock |

## 1. A privileged service that trusts its callers

`system_server` hosts a vendor service that every vendor app uses to reach hardware and policy: set
system properties as the system UID, read and write calibration records, change per-app display
settings, set or clear the lock credential, install and uninstall packages silently, wipe app data,
capture the screen, inject key events. **read + probed.**

The service clears the calling identity at the top of each method and never checks who called. The
SELinux policy allows the find operation for untrusted app domains. So the boundary that is supposed
to separate "vendor app" from "anything on the device" is not there; it is a convention.

Impact: an app with no declared permissions can perform system-UID actions, including changing the
lock credential, silently removing other apps, and capturing the display. On a `userdebug` build the
device already ships root, so this does not escalate much *for this device* — but it means the
security model does not depend on root at all, and it would survive a future build that removed
`su` while keeping the service.

Fix direction: define a `signature|privileged` permission, and enforce it at the top of every binder
method *before* `clearCallingIdentity`. Remove `untrusted_app` from the service's
`service_manager find` rules in the vendor SELinux policy.

## 2. The lock screen, in a property

When a lock credential is set, the vendor path reconstructs it from a persistent system property
that holds the credential in plaintext with a type prefix — and logs it. **read + probed.** The
property exists so the service can change or clear a credential without prompting for the old one.

Impact: anything that can read system properties can read the PIN, and the value is written to
logcat on every change. The property is also in the persistent-properties file on disk.

Fix direction: keep the credential inside `LockPatternUtils` / synthetic password. If a caller needs
to change a credential, pass the old one from a verified UI session.

## 3–4. Two content providers that should not be exported {#providers}

One exported provider implements exactly one real method: open a file by the path in the URI. The
path comes from the caller, unvalidated. **read; probed only in the sense that the provider is
present and exported.**

Impact: any app reads any file the owning app can — including the AI chat database and preference
files that carry an account token.

A second provider exposes a user credential behind a permission that the manifest declares at
`normal` protection level. **read.** Any app can request a `normal` permission at install time,
without a prompt.

Fix direction: for the first, drop the provider or validate both caller and path. For the second,
`protectionLevel="signature"`.

## 5. TLS that does not verify

The network layer used by the settings/upgrade app installs a trust manager whose
`checkServerTrusted` is empty and a hostname verifier that returns true. **read.** The app targets
API 28 and permits cleartext, so both directions are open.

Impact: on a hostile network, update metadata, waveform checks and login traffic can be intercepted
and modified. The update path verifies file hashes, but the metadata that supplies those hashes
arrives over the same unverified channel.

Fix direction: remove the custom trust manager and verifier; the platform defaults are correct.

## 6. Shared secrets in the client

Two kinds of secret ship inside the artifacts: a request-signing salt used by the HTTP layer and the
device-check service, and the AES key/IV that wrap the waveform hash check. **read.** I am not
reproducing either.

Impact: a signing salt in every client is an integrity check only against accident, not against an
adversary. The waveform key is more interesting: the checker and the secret are in the same binary,
so the check authenticates "this file was produced by someone who read this binary", not "this file
came from the vendor".

Fix direction: asymmetric signatures — a public key in the device, a private key on the server. The
waveform manifest should be signed, not hashed-and-encrypted with a embedded symmetric key.

## 7. The platform key is public

Several `/product` apps, including one that shares the system UID, are signed with AOSP's published
test platform key, while the build reports `release-keys`. **read + probed.**

Impact: anyone can build an APK that updates those apps in place, keeps `android.uid.system`, and
holds signature-level permissions. I am not publishing a rebuilt app; the point of the finding is
that the key choice, not the skill of an attacker, is what makes this possible.

Fix direction: re-sign the product with private release keys (`sign_target_files_apks`), and treat
the test key's presence as a release blocker.

## 8. A kill switch that outlives the device's owner

On every validated network the device asks the vendor whether it is blocked, keyed on a device
identifier and a signature over the request path. If the answer is "blocked", the service writes a
flag byte into a raw calibration partition, covers the screen with a non-dismissible alert, and
starts a five-minute countdown ending in forced shutdown. **read + probed.** The flag survives a
factory reset, a data wipe and a system update, because it is in neither `super` nor `userdata`.

Impact: a single server response, or a mis-keyed record, permanently disables a device the owner
paid for. There is no offline dispute path and no owner-controlled override. The failure mode is not
"the app stops working", it is "the hardware stops being usable".

Fix direction: this one is a product decision, not a patch. If a vendor must be able to disable a
device (fraud, non-payment, stolen stock), the state should be visible to the owner, revocable
through a channel the owner controls, and should not be stored where the owner's own recovery
cannot reach it. A device sold outright should not have this path at all.

I am not documenting how to clear the byte, and the recovery I would describe in private to the
vendor is not something I would publish.

## What I did not do

- No exploitation beyond what was needed to confirm each claim, and no data exfiltration.
- No proof-of-concept, no exploit code, no key material, no identifiers.
- No testing against any device but mine, and none against the vendor's servers beyond ordinary
  update-check traffic from the device itself.
- Nothing published here was found by attacking a third party; all of it is my own hardware.

If you are the vendor and you would like the detail behind any row, I am happy to share it in
private.
