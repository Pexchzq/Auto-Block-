import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

const PURPLE = 0xa855f7;
const GREEN = 0x38d996;
const RED = 0xf05252;
const DEFAULT_PANEL_IMAGE_URL =
  "https://raw.githubusercontent.com/Pexchzq/Auto-Block-/main/discord-bot/assets/orions-panel-v2.gif";

function count(value) {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}ชม.${String(minutes).padStart(2, "0")}น.`;
  if (minutes > 0) return `${minutes}น.${String(secs).padStart(2, "0")}วิ`;
  return `${secs}วิ`;
}

function progressBar(percent, width = 14) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((clamped / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

const QUEUE_STATUS_ICON = { queued: "⏳", running: "⚙️", retrying: "🔁" };
const QUEUE_LIST_LIMIT = 10;

function queueListText(entries) {
  if (!entries || entries.length === 0) return "ไม่มีงานในคิวตอนนี้";
  const shown = entries.slice(0, QUEUE_LIST_LIMIT);
  const lines = shown.map((entry) => {
    const icon = QUEUE_STATUS_ICON[entry.status] || "•";
    return `\`#${entry.position}\` ${icon} **${entry.name}** — ${entry.percent}%`;
  });
  const extra = entries.length - shown.length;
  if (extra > 0) lines.push(`...และอีก ${extra} งาน`);
  return lines.join("\n");
}

export function panelEmbed(queue = {}, avatarURL) {
  const online = queue.online !== false;
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setAuthor({ name: "Orions Service", iconURL: avatarURL })
    .setTitle("Orions Automation Center")
    .setDescription(
      "เลือกเครื่องมือที่ต้องการ ระบบจะรับไฟล์ผ่าน DM และส่งสถานะกับรายงานกลับแบบส่วนตัว",
    )
    .addFields(
      { name: "สถานะระบบ", value: online ? "🟢 ONLINE" : "🟠 DEGRADED", inline: true },
      { name: "คิวงาน", value: queueListText(queue.entries) },
    )
    .setFooter({ text: "Orions • Live queue refreshes automatically" })
    .setTimestamp();
  if (avatarURL) embed.setThumbnail(avatarURL);
  embed.setImage(process.env.DISCORD_PANEL_IMAGE_URL || DEFAULT_PANEL_IMAGE_URL);
  return embed;
}

export function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("orions:topup")
        .setLabel("เติมเงิน")
        .setEmoji("💳")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("orions:user")
        .setLabel("ข้อมูลผู้ใช้")
        .setEmoji("👤")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("orions:tools")
        .setLabel("เครื่องมือ")
        .setEmoji("🧰")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function toolPickerEmbed() {
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("เลือกเครื่องมือ")
    .setDescription(
      "เลือกบริการจากเมนูด้านล่าง เครื่องมือใหม่จะเพิ่มในรายการนี้ภายหลังโดยไม่ต้องเปลี่ยน panel หลัก",
    );
}

export function toolPickerComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("orions:tool-select")
        .setPlaceholder("เลือกเครื่องมือที่จะใช้")
        .addOptions({
          label: "บล็อคไอดี v1",
          description: "บล็อคทุกบัญชีแบบสองทาง พร้อมรายงานทาง DM",
          value: "block-id-v1",
          emoji: "🛡️",
        }),
    ),
  ];
}

export function topUpEmbed(user, paymentStatus = {}) {
  const ready = paymentStatus.liveTrueMoneyEnabled === true
    || paymentStatus.placeholderTopUpEnabled === true;
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle("เติมเงิน Orions")
    .setDescription("กรอกลิงก์ซอง TrueMoney ผ่านแบบฟอร์มส่วนตัว ระบบจะเพิ่มยอดตามจำนวนเงินจริงเมื่อยืนยันสำเร็จ")
    .addFields(
      {
        name: "ยอดคงเหลือ",
        value: `💳 ${Number(user.balanceBaht || 0).toFixed(2)} บาท`,
        inline: true,
      },
      {
        name: "สถานะ",
        value: ready ? "🟢 พร้อมรับซอง" : "🟠 ยังไม่เชื่อม Provider",
        inline: true,
      },
    )
    .setFooter({ text: "ลิงก์ซองจะไม่ถูกแสดงในห้องและไม่ถูกบันทึกลงรายงาน" });
}

export function topUpComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("orions:topup:voucher")
        .setLabel("ใส่ลิงก์ซอง")
        .setEmoji("🎁")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

export function topUpResultEmbed(result, balanceBaht) {
  return new EmbedBuilder()
    .setColor(result.accepted ? GREEN : PURPLE)
    .setTitle(result.accepted ? "เติมเงินสำเร็จ" : "ซองนี้ไม่ได้เพิ่มยอด")
    .setDescription(result.message || "TrueMoney processing finished")
    .addFields(
      { name: "ยอดที่เพิ่ม", value: `🎁 ${Number(result.creditedBaht || 0).toFixed(2)} บาท`, inline: true },
      { name: "ยอดคงเหลือ", value: `💳 ${Number(balanceBaht || 0).toFixed(2)} บาท`, inline: true },
      { name: "รายการ", value: result.transactionId ? `\`${String(result.transactionId).slice(0, 80)}\`` : "-", inline: false },
    )
    .setFooter({ text: "Orions TrueMoney receiver" })
    .setTimestamp();
}

export function statusEmbed(job, title = "กำลังประมวลผล") {
  const blocked = Number(job.blocked || 0);
  const alreadyBlocked = Number(job.alreadyBlocked || 0);
  const failed = Number(job.failed || 0);
  const done = blocked + alreadyBlocked + failed;
  const total = Number(job.directedPairs || 0);
  const remaining = Math.max(0, total - done);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 0;
  const isTerminal = ["completed", "failed", "cancelled"].includes(job.status);

  const elapsedSeconds = Number(job.elapsedSeconds || 0);
  const speedPerMin = elapsedSeconds > 0 && done > 0
    ? Math.round((done / (elapsedSeconds / 60)) * 10) / 10
    : 0;
  const successRate = job.successRate !== undefined && job.successRate !== null
    ? Number(job.successRate)
    : (done > 0 ? Math.round(((blocked + alreadyBlocked) / done) * 1000) / 10 : 0);
  const etaSeconds = Number(job.etaSeconds || 0);

  const color = job.status === "completed" ? GREEN : ["failed", "cancelled"].includes(job.status) ? RED : PURPLE;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `งาน \`${job.jobId}\`\n` +
      `สถานะ: **${job.status}**  •  เครื่องมือ: 🛡️ BlockMesh Engine (user-blocking-api)\n` +
      `${progressBar(percent)}  **${percent}%**`,
    )
    .addFields(
      { name: "ความคืบหน้า", value: `${done.toLocaleString()} / ${total.toLocaleString()} คู่ (เหลือ ${remaining.toLocaleString()})` },
      { name: "สำเร็จ", value: `✅ ${count(blocked)}`, inline: true },
      { name: "มีอยู่แล้ว", value: `🔁 ${count(alreadyBlocked)}`, inline: true },
      { name: "ไม่สำเร็จ", value: `❌ ${count(failed)}`, inline: true },
      { name: "อัตราสำเร็จ", value: `📊 ${successRate}%`, inline: true },
      {
        name: "ความเร็ว",
        value: speedPerMin > 0 ? `⚡ ${speedPerMin.toLocaleString()}/นาที` : "⚡ กำลังคำนวณ...",
        inline: true,
      },
      {
        name: isTerminal ? "ใช้เวลาไป" : "เหลืออีกประมาณ",
        value: isTerminal
          ? `⏱️ ${formatDuration(elapsedSeconds)}`
          : (etaSeconds > 0 ? `⏳ ${formatDuration(etaSeconds)}` : "⏳ กำลังคำนวณ..."),
        inline: true,
      },
    );

  if (Number(job.reservedBaht || 0) > 0) {
    embed.addFields({
      name: "ค่าใช้จ่าย",
      value: isTerminal
        ? `💳 คิดเงิน ${Number(job.chargedBaht || 0).toFixed(2)} บาท` +
          (Number(job.refundedBaht || 0) > 0 ? ` • คืน ${Number(job.refundedBaht || 0).toFixed(2)} บาท` : "")
        : `💳 กันเงินไว้ ${Number(job.reservedBaht || 0).toFixed(2)} บาท`,
    });
  }

  embed
    .setFooter({
      text: isTerminal
        ? "แนบรายงาน JSON ฉบับเต็มมากับข้อความนี้"
        : "ข้อความนี้จะอัปเดตอัตโนมัติทุก ~10 วินาที",
    })
    .setTimestamp();
  return embed;
}

export function finalEmbed(job) {
  return statusEmbed(job, job.status === "completed" ? "✅ ดำเนินการเสร็จแล้ว" : "⚠️ งานสิ้นสุด");
}

export function userEmbed(user, displayName) {
  const jobs = Array.isArray(user.jobs) ? user.jobs : [];
  const active = jobs.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length;
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(displayName)
    .addFields(
      { name: "Balance", value: `🎁 ${Number(user.balanceBaht || 0).toFixed(2)} บาท`, inline: true },
      { name: "งานทั้งหมด", value: `${jobs.length}`, inline: true },
      { name: "งานที่กำลังทำ", value: `${active}`, inline: true },
      { name: "สิทธิ์", value: "Free Mode" },
    )
    .setTimestamp();
}
