import {
  ActionRowBuilder,
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createJob, getActiveJobs, getJob, getReport, getUser } from "./api.mjs";
import { downloadAccountText } from "./download.mjs";
import { csvEnv, loadEnv, requiredEnv } from "./env.mjs";
import { safeError } from "./sanitize.mjs";
import {
  finalEmbed,
  panelComponents,
  panelEmbed,
  statusEmbed,
  userEmbed,
} from "./ui.mjs";

await loadEnv();

const CONFIG = {
  token: requiredEnv("DISCORD_BOT_TOKEN"),
  guildId: requiredEnv("DISCORD_GUILD_ID"),
  allowedRoleIds: csvEnv("DISCORD_ALLOWED_ROLE_IDS"),
  panelChannelId: String(process.env.DISCORD_PANEL_CHANNEL_ID || "").trim(),
  pollIntervalMs: Math.max(5_000, Number(process.env.POLL_INTERVAL_MS || 10_000)),
  reportMaxBytes: Math.max(256_000, Number(process.env.DISCORD_REPORT_MAX_BYTES || 7_500_000)),
};

if (CONFIG.allowedRoleIds.length === 0) {
  throw new Error("DISCORD_ALLOWED_ROLE_IDS must contain at least one role id");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const pendingDmMessages = new Map();
const monitors = new Map();
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function privateReply(interaction, content) {
  return interaction.reply({
    content,
    ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

function privateDefer(interaction) {
  return interaction.deferReply(
    interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {},
  );
}

async function isAllowedUser(userId) {
  const guild = await client.guilds.fetch(CONFIG.guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  return Boolean(member && CONFIG.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId)));
}

async function requireAllowedUser(interaction) {
  if (await isAllowedUser(interaction.user.id)) return true;
  await privateReply(interaction, "บัญชีของคุณไม่มี role ที่อนุญาตให้ใช้ Orions");
  return false;
}

function submitModal() {
  const linkInput = new TextInputBuilder()
    .setCustomId("file_url")
    .setLabel("ลิงก์ไฟล์ cookies.txt จาก Discord")
    .setPlaceholder("https://cdn.discordapp.com/attachments/...")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(1_000);

  return new ModalBuilder()
    .setCustomId("blockmesh:submit")
    .setTitle("สร้างงาน Orions")
    .addComponents(new ActionRowBuilder().addComponents(linkInput));
}

async function openSubmission(interaction) {
  if (!(await requireAllowedUser(interaction))) return;

  let message;
  try {
    message = await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff7900)
          .setTitle("พร้อมรับงาน Orions")
          .setDescription("กำลังรอข้อมูลจากแบบฟอร์ม ระบบจะอัปเดตสถานะงานในข้อความนี้"),
      ],
    });
  } catch {
    await privateReply(
      interaction,
      "ไม่สามารถส่ง DM ถึงคุณได้ กรุณาเปิดรับข้อความส่วนตัวจากสมาชิกในเซิร์ฟเวอร์แล้วลองใหม่",
    );
    return;
  }

  pendingDmMessages.set(interaction.user.id, {
    message,
    createdAt: Date.now(),
  });
  await interaction.showModal(submitModal());
}

function compactReport(job, report, reason) {
  return {
    jobId: job.jobId,
    status: job.status,
    accountsUsed: job.accountsUsed,
    directedPairs: job.directedPairs,
    blocked: job.blocked,
    alreadyBlocked: job.alreadyBlocked,
    failed: job.failed,
    successRate: job.successRate,
    chargedBaht: job.chargedBaht,
    refundedBaht: job.refundedBaht,
    generatedAt: new Date().toISOString(),
    reportNotice: reason,
    reportSummary: report && typeof report === "object"
      ? {
          command: report.command,
          durationMs: report.durationMs,
          rateLimitCount: report.rateLimitCount,
          topFailureReasons: report.topFailureReasons,
          recommendation: report.recommendation,
        }
      : null,
  };
}

function reportAttachment(job, report) {
  const fullJson = JSON.stringify(report || compactReport(job, null, "No report payload"), null, 2);
  let buffer = Buffer.from(fullJson, "utf8");
  if (buffer.byteLength > CONFIG.reportMaxBytes) {
    buffer = Buffer.from(
      JSON.stringify(compactReport(job, report, "Full report exceeded Discord attachment limit"), null, 2),
      "utf8",
    );
  }
  return new AttachmentBuilder(buffer, { name: `blockmesh-report-${job.jobId}.json` });
}

async function finishMonitor(entry, job) {
  let report = null;
  try {
    const response = await getReport(entry.discordUserId, job.jobId);
    report = response.report || null;
  } catch (error) {
    report = compactReport(job, null, `Report lookup failed: ${safeError(error)}`);
  }

  await entry.message.edit({
    content: "",
    embeds: [finalEmbed(job)],
    files: [reportAttachment(job, report)],
  });
  monitors.delete(job.jobId);
}

async function pollMonitor(jobId) {
  const entry = monitors.get(jobId);
  if (!entry || entry.polling) return;
  entry.polling = true;

  try {
    const response = await getJob(entry.discordUserId, jobId);
    const job = response.job;
    entry.failures = 0;
    if (TERMINAL_STATUSES.has(job.status)) {
      await finishMonitor(entry, job);
      return;
    }
    await entry.message.edit({ content: "", embeds: [statusEmbed(job)] });
  } catch (error) {
    entry.failures += 1;
    if (entry.failures === 1 || entry.failures % 6 === 0) {
      await entry.message.edit({
        content: `ตรวจสถานะชั่วคราวไม่สำเร็จ: ${safeError(error)}`,
      }).catch(() => undefined);
    }
  } finally {
    const current = monitors.get(jobId);
    if (current) {
      current.polling = false;
      current.timer = setTimeout(() => void pollMonitor(jobId), CONFIG.pollIntervalMs);
    }
  }
}

function monitorJob(discordUserId, job, message) {
  const existing = monitors.get(job.jobId);
  if (existing?.timer) clearTimeout(existing.timer);
  monitors.set(job.jobId, {
    discordUserId,
    message,
    failures: 0,
    polling: false,
    timer: setTimeout(() => void pollMonitor(job.jobId), 1_000),
  });
}

async function handleSubmission(interaction) {
  if (!(await requireAllowedUser(interaction))) return;
  await privateDefer(interaction);

  const pending = pendingDmMessages.get(interaction.user.id);
  pendingDmMessages.delete(interaction.user.id);
  let progressMessage = pending?.message;

  try {
    if (!progressMessage) {
      progressMessage = await interaction.user.send("กำลังตรวจสอบไฟล์และสร้างงาน Orions...");
    } else {
      await progressMessage.edit({
        content: "กำลังตรวจสอบไฟล์และสร้างงาน Orions...",
        embeds: [],
      });
    }

    const fileUrl = interaction.fields.getTextInputValue("file_url");
    let accountText = await downloadAccountText(fileUrl);
    const response = await createJob(interaction.user.id, accountText, "balanced");
    accountText = "";
    const job = response.job;

    await progressMessage.edit({
      content: "",
      embeds: [statusEmbed(job, "รับงานแล้ว")],
    });
    await interaction.editReply(
      `รับงานแล้ว: \`${job.jobId}\` จำนวน ${Number(job.accountsUsed).toLocaleString()} บัญชี ` +
      `(${Number(job.directedPairs).toLocaleString()} คู่) ติดตามผลได้ใน DM`,
    );
    monitorJob(interaction.user.id, job, progressMessage);
  } catch (error) {
    const message = safeError(error);
    await progressMessage?.edit({
      content: `สร้างงานไม่สำเร็จ: ${message}`,
      embeds: [],
    }).catch(() => undefined);
    await interaction.editReply(`สร้างงานไม่สำเร็จ: ${message}`);
  }
}

async function showUser(interaction) {
  if (!(await requireAllowedUser(interaction))) return;
  await privateDefer(interaction);
  try {
    const user = await getUser(interaction.user.id);
    await interaction.editReply({
      embeds: [userEmbed(user, interaction.user.displayName || interaction.user.username)],
    });
  } catch (error) {
    await interaction.editReply(`อ่านข้อมูลผู้ใช้ไม่สำเร็จ: ${safeError(error)}`);
  }
}

async function showStatus(interaction) {
  if (!(await requireAllowedUser(interaction))) return;
  await privateDefer(interaction);
  try {
    const jobId = interaction.options.getString("job_id", true);
    const response = await getJob(interaction.user.id, jobId);
    await interaction.editReply({ embeds: [statusEmbed(response.job, "สถานะงาน")] });
  } catch (error) {
    await interaction.editReply(`อ่านสถานะไม่สำเร็จ: ${safeError(error)}`);
  }
}

async function installPanel(interaction) {
  const channelId = CONFIG.panelChannelId || interaction.channelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    await privateReply(interaction, "ไม่พบ text channel สำหรับติดตั้ง control panel");
    return;
  }
  await channel.send({ embeds: [panelEmbed()], components: panelComponents() });
  await privateReply(interaction, `ติดตั้ง Orions panel ใน <#${channel.id}> แล้ว`);
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === "blockmesh:create") return await openSubmission(interaction);
      if (interaction.customId === "blockmesh:user") return await showUser(interaction);
      if (interaction.customId === "blockmesh:tools") {
        return await privateReply(
          interaction,
          "อัปโหลดไฟล์ `.txt` ไปยัง Discord แล้วคัดลอกลิงก์ไฟล์ จากนั้นกด **สร้างงาน** และวางลิงก์ในแบบฟอร์ม ผลลัพธ์จะส่งทาง DM",
        );
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === "blockmesh:submit") {
      return await handleSubmission(interaction);
    }

    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "panel") return await installPanel(interaction);
    if (interaction.commandName !== "block") return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "submit") return await openSubmission(interaction);
    if (subcommand === "status") return await showStatus(interaction);
    if (subcommand === "wallet") return await showUser(interaction);
  } catch (error) {
    const message = `เกิดข้อผิดพลาด: ${safeError(error)}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => undefined);
    } else {
      await privateReply(interaction, message).catch(() => undefined);
    }
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Orions Discord bot ready as ${readyClient.user.tag}`);
  try {
    const response = await getActiveJobs();
    for (const entry of response.jobs || []) {
      const user = await client.users.fetch(entry.discordUserId).catch(() => null);
      if (!user) continue;
      const message = await user.send({ embeds: [statusEmbed(entry.job, "กลับมาติดตามงานต่อ")] }).catch(() => null);
      if (message) monitorJob(entry.discordUserId, entry.job, message);
    }
    console.log(`Recovered ${monitors.size} active Discord job monitor(s)`);
  } catch (error) {
    console.error(`Active job recovery failed: ${safeError(error)}`);
  }
});

process.on("unhandledRejection", (error) => {
  console.error(`Unhandled rejection: ${safeError(error)}`);
});

process.on("uncaughtException", (error) => {
  console.error(`Uncaught exception: ${safeError(error)}`);
});

await client.login(CONFIG.token);
