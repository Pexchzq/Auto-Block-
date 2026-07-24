---
name: blockmesh-throughput-ceiling
description: Why BlockMesh block throughput is capped and how to actually scale it
metadata:
  type: project
---

BlockMesh apply throughput is bounded by a single global request-spacing gate
(`waitForGlobalBlockSlot` + `GLOBAL_BLOCK_SLOT_CHAIN` in `block-mesh.js`), which
serializes ALL block requests across every source lane at `globalBlockDelayMs`
(350ms balanced → ~171 blocks/min). `accountConcurrency` only hides network
latency; it does NOT raise sustained throughput.

**Why (CONFIRMED by lab experiments E1–E4, 2026-07-24):** Roblox enforces a
SHARED rate bucket at ~115-130/min sustained (burst allowance ~80-100 requests,
then refill ~115/min). It is NOT per-account (each account 429s at ~4/min under
load) and NOT beatable by running multiple processes on one IP (two parallel
processes summed to ~108/min = same as one, both 429'd heavily). Throughput rises
with lane count only until the global gate is saturated; 42 accounts at balanced
470→380ms ≈ 115/min at 1.5% fail is already near the single-IP ceiling.

**How to apply:** The ONLY way past ~130/min is multiple egress IPs. Proxy support
is built in: `--proxies proxies.txt` assigns each account a proxy round-robin
(pure-Node HTTPS CONNECT tunnel, no deps; see `makeProxyAgent`/`assignProxies`).
The pacing gate is now PER-EGRESS-IP (`NET_LANES` map keyed by proxy, replacing
the old single global gate) so N proxies run as N parallel ~115/min streams →
~N× throughput on ONE full mesh. accountConcurrency cap raised to 64; set it
≈ proxies×4 to saturate them. Distribute by SOURCE not by group (target is just a
userId, so the full N×(N−1) mesh stays complete). Spare machines on other home
lines can serve as egress IPs via `proxy-server.js` (pure-Node CONNECT proxy,
reach them over Tailscale). Prefer residential/mobile proxies.
NOTE: CONNECT tunnel + per-proxy gate still need one live smoke test with a real
proxy. Tools: `split-accounts.mjs`, `proxy-server.js`, `proxies.txt.example`.
See [[blockmesh-cookie-format]] and [[blockmesh-auth-failure-categories]].
