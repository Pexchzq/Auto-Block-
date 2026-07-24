---
name: blockmesh-auth-failure-categories
description: How BlockMesh classifies why a cookie/account fails validation
metadata:
  type: project
---

`block-mesh.js` classifies auth failures via `classifyAuthFailure(result)` from
HTTP status + `rblx-challenge-type` header + error body message, instead of the
old catch-all `challenge_or_forbidden`. Categories: `invalid_cookie` (401),
`moderated` / `banned` (403 body "User is moderated"/terminated),
`challenge_captcha` / `challenge_2fa` / `challenge_verification` (403 with
challenge header), `rate_limited` (429), `server_error` (5xx).

Validate report now carries `summary.failureBreakdown` (counts per reason) and
each account has `status` + `error`. `one-click-auto.ps1` treats moderated/
banned/invalid/challenge as PERMANENT: it skips them and runs the mesh on usable
accounts only (retries validation solely for transient rate_limited/server_error).

**Note:** an account showing "User is moderated" (403) is the same locked state
some external checkers label "ล็อกใบหน้า" (face/age verification gate) — the
cookie is live but the account must clear a Roblox gate manually; not auto-fixable.
Related: [[blockmesh-cookie-format]].
