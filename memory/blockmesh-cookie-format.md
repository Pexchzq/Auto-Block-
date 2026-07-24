---
name: blockmesh-cookie-format
description: BlockMesh cookie input parsing is anchored on the _|WARNING marker
metadata:
  type: project
---

Cookie/account input parsing (CLI `parseCookiesFile` in `block-mesh.js` and web
`validateAccountInput` in `web/src/lib/accounts.ts`) is anchored on the literal
`_|WARNING` marker, not on colon position. Everything from `_|WARNING` onward is
the cookie; the prefix before it is optional `alias[:password[:...]]`.

Accepted forms: `user:pass:_|WARNING...`, `user:_|WARNING...`, raw `_|WARNING...`,
and passwords containing extra colons. Password is parsed for reference only and
is NEVER used for auth — auth is 100% ROBLOSECURITY-cookie based.

**Why:** old parser required an exact `username:password:cookie` triple and broke
on missing password or colons; users paste many shapes.

**How to apply:** keep both parsers in sync when changing the contract; the web
validator must stay a superset-compatible gate for what the CLI accepts. Related:
[[blockmesh-throughput-ceiling]].
