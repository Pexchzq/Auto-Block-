import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

const ORANGE = 0xff7900;
const GREEN = 0x38d996;
const RED = 0xf05252;
const DEFAULT_PANEL_IMAGE_URL =
  "https://raw.githubusercontent.com/Pexchzq/Auto-Block-/main/discord-bot/assets/orions-panel-v1.gif";

function count(value) {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

export function panelEmbed(queue = {}) {
  const online = queue.online !== false;
  const embed = new EmbedBuilder()
    .setColor(ORANGE)
    .setAuthor({ name: "Orions Service" })
    .setTitle("Orions Automation Center")
    .setDescription(
      "เลือกเครื่องมือที่ต้องการ ระบบจะรับไฟล์ผ่าน DM และส่งสถานะกับรายงานกลับแบบส่วนตัว",
    )
    .addFields(
      { name: "สถานะระบบ", value: online ? "🟢 ONLINE" : "🟠 DEGRADED", inline: true },
      { name: "คิวรอ", value: `📥 ${count(queue.queued)} งาน`, inline: true },
      { name: "กำลังทำ", value: `⚙️ ${count(queue.running)} งาน`, inline: true },
      { name: "กำลังรีไทร", value: `🔁 ${count(queue.retrying)} งาน`, inline: true },
      { name: "เครื่องมือพร้อมใช้", value: "🛡️ บล็อคไอดี v1", inline: true },
      { name: "โหมดบริการ", value: "🎁 Free Mode", inline: true },
    )
    .setFooter({ text: "Orions • Live queue refreshes automatically" })
    .setTimestamp();
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
    .setColor(ORANGE)
    .setTitle("เลือกเครื่องมือ")
    .setDescription(
      "เลือกบริการจากเมนูด้านล่าง เครื่องมือใหม่จะเพิ่มในรายการนี้ภายหลังโดยไม่ต้องเปลี่ยน panel หลัก",
    )
    .addFields({
      name: "พร้อมใช้งาน",
      value: "🛡️ **บล็อคไอดี v1**\nบล็อคบัญชีทุกคู่แบบสองทาง พร้อมติดตามผลและรายงานผ่าน DM",
    });
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

export function topUpComponents(url) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("orions:topup:voucher")
        .setLabel("ใส่ลิงก์ซอง")
        .setEmoji("🎁")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setLabel("เปิดเว็บไซต์")
        .setEmoji("↗️")
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    ),
  ];
}

export function topUpResultEmbed(result, balanceBaht) {
  return new EmbedBuilder()
    .setColor(result.accepted ? GREEN : ORANGE)
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
  const done = Number(job.blocked || 0) + Number(job.alreadyBlocked || 0) + Number(job.failed || 0);
  const total = Number(job.directedPairs || 0);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 0;
  return new EmbedBuilder()
    .setColor(["failed", "cancelled"].includes(job.status) ? RED : ORANGE)
    .setTitle(title)
    .setDescription(`งาน \`${job.jobId}\`\nสถานะ: **${job.status}**`)
    .addFields(
      { name: "ความคืบหน้า", value: `${done.toLocaleString()} / ${total.toLocaleString()} (${percent}%)` },
      { name: "สำเร็จ", value: `✅ ${Number(job.blocked || 0).toLocaleString()}`, inline: true },
      { name: "มีอยู่แล้ว", value: `🔁 ${Number(job.alreadyBlocked || 0).toLocaleString()}`, inline: true },
      { name: "ไม่สำเร็จ", value: `❌ ${Number(job.failed || 0).toLocaleString()}`, inline: true },
    )
    .setFooter({ text: "ข้อความนี้จะอัปเดตอัตโนมัติ" })
    .setTimestamp();
}

export function finalEmbed(job) {
  return statusEmbed(job, job.status === "completed" ? "ดำเนินการเสร็จแล้ว" : "งานสิ้นสุด")
    .setColor(job.status === "completed" ? GREEN : RED)
    .setFooter({ text: "แนบรายงาน JSON มากับข้อความนี้" });
}

export function userEmbed(user, displayName) {
  const jobs = Array.isArray(user.jobs) ? user.jobs : [];
  const active = jobs.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length;
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(displayName)
    .addFields(
      { name: "Balance", value: `🎁 ${Number(user.balanceBaht || 0).toFixed(2)} บาท`, inline: true },
      { name: "งานทั้งหมด", value: `${jobs.length}`, inline: true },
      { name: "งานที่กำลังทำ", value: `${active}`, inline: true },
      { name: "สิทธิ์", value: "Free Mode" },
    )
    .setTimestamp();
}
