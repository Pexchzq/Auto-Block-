#!/usr/bin/env node
"use strict";

// Minimal HTTPS CONNECT proxy (pure Node, no dependencies) — วิธี B.
// Run this on each spare machine (each has its own home IP). The main machine
// points block-mesh.js at them via --proxies to spread egress across IPs.
//
// Run:
//   PROXY_PORT=8080 PROXY_USER=me PROXY_PASS=secret node proxy-server.js
// (PowerShell)
//   $env:PROXY_PORT=8080; $env:PROXY_USER="me"; $env:PROXY_PASS="secret"; node proxy-server.js
//
// SECURITY: always set PROXY_USER/PROXY_PASS. An open CONNECT proxy will be
// abused within minutes if exposed to the internet. Prefer reaching it over a
// private mesh (Tailscale) instead of router port-forwarding.

const http = require("node:http");
const net = require("node:net");

const PORT = Number(process.env.PROXY_PORT || 8080);
const USER = process.env.PROXY_USER || "";
const PASS = process.env.PROXY_PASS || "";
const requireAuth = Boolean(USER || PASS);

let active = 0;
let total = 0;

const server = http.createServer((req, res) => {
  res.writeHead(405, { "content-type": "text/plain" });
  res.end("This is a CONNECT (HTTPS tunnel) proxy.\n");
});

server.on("connect", (req, clientSocket, head) => {
  if (requireAuth) {
    const provided = req.headers["proxy-authorization"] || "";
    const expected = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
    if (provided !== expected) {
      clientSocket.write(
        "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"blockmesh\"\r\n\r\n",
      );
      clientSocket.end();
      return;
    }
  }

  const [host, portRaw] = String(req.url).split(":");
  const port = Number(portRaw) || 443;
  const upstream = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    active += 1;
    total += 1;
  });

  const cleanup = () => {
    active = Math.max(0, active - 1);
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", () => {
    clientSocket.end();
    cleanup();
  });
  clientSocket.on("error", cleanup);
  clientSocket.on("close", cleanup);
});

server.listen(PORT, () => {
  console.log(`CONNECT proxy listening on :${PORT}  auth=${requireAuth ? "on" : "OFF (insecure!)"}`);
  console.log(`Point block-mesh.js at:  <this-machine-ip>:${PORT}${requireAuth ? "  (user:pass@)" : ""}`);
});

setInterval(() => {
  console.log(`[proxy] active=${active} totalHandled=${total}`);
}, 30000).unref();
