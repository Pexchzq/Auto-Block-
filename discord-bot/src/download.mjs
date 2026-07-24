const DEFAULT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function isAllowedAccountFileUrl(value, allowedHosts = DEFAULT_HOSTS) {
  try {
    const url = new URL(String(value || "").trim());
    const fileName = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    return (
      url.protocol === "https:" &&
      allowedHosts.has(url.hostname.toLowerCase()) &&
      url.pathname.startsWith("/attachments/") &&
      fileName.toLowerCase().endsWith(".txt") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export async function downloadAccountText(value, options = {}) {
  const maxBytes = Math.max(1024, Number(options.maxBytes || process.env.COOKIE_URL_MAX_BYTES || 2 * 1024 * 1024));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.COOKIE_DOWNLOAD_TIMEOUT_MS || 15000));
  const allowedHosts = options.allowedHosts || DEFAULT_HOSTS;
  if (!isAllowedAccountFileUrl(value, allowedHosts)) {
    throw new Error("รองรับเฉพาะลิงก์ไฟล์จาก Discord CDN");
  }

  const response = await fetch(String(value).trim(), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "BlockMeshDiscordBot/1.0" },
  });
  if (response.status >= 300 && response.status < 400) throw new Error("ลิงก์ไฟล์ redirect ไปยังตำแหน่งอื่น");
  if (!response.ok) throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ (HTTP ${response.status})`);

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("ไฟล์มีขนาดเกินกำหนด");
  if (!response.body) throw new Error("ไฟล์ไม่มีข้อมูล");

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("ไฟล์มีขนาดเกินกำหนด");
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new Error("ไฟล์ว่าง");

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    throw new Error("ไฟล์ต้องเป็น UTF-8");
  }
  if (!text.trim()) throw new Error("ไฟล์ว่าง");
  return text.replace(/^\uFEFF/, "");
}
