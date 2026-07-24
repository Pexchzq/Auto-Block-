import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const ORANGE = 0xff7900;
const GREEN = 0x38d996;
const RED = 0xf05252;

export function panelEmbed() {
  const embed = new EmbedBuilder()
    .setColor(ORANGE)
    .setAuthor({ name: "BlockMesh Service" })
    .setTitle("BlockMesh Automation")
    .setDescription("สร้างงานบล็อก ติดตามคิว และรับรายงานผ่าน DM ส่วนตัว")
    .addFields(
      { name: "ระบบ", value: "🟢 พร้อมรับงาน", inline: true },
      { name: "โหมด", value: "🎁 Free Mode", inline: true },
      { name: "Worker", value: "ทำงานทีละ 1 คิว", inline: true },
    )
    .setFooter({ text: "BlockMesh • Discord Control Panel" })
    .setTimestamp();
  if (process.env.DISCORD_PANEL_IMAGE_URL) embed.setImage(process.env.DISCORD_PANEL_IMAGE_URL);
  return embed;
}

export function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("blockmesh:create").setLabel("สร้างงาน").setEmoji("🧩").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("blockmesh:user").setLabel("ข้อมูลผู้ใช้").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("blockmesh:tools").setLabel("เครื่องมือ").setEmoji("🎁").setStyle(ButtonStyle.Secondary),
    ),
  ];
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
