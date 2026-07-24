import {
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { loadEnv, requiredEnv } from "../src/env.mjs";

await loadEnv();

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("ติดตั้ง BlockMesh control panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("block")
    .setDescription("BlockMesh commands")
    .addSubcommand((command) => command.setName("submit").setDescription("เปิดฟอร์มสร้างงาน"))
    .addSubcommand((command) => command
      .setName("status")
      .setDescription("ตรวจสถานะงาน")
      .addStringOption((option) => option.setName("job_id").setDescription("Job ID").setRequired(true)))
    .addSubcommand((command) => command.setName("wallet").setDescription("ดูข้อมูลผู้ใช้และยอดคงเหลือ")),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(requiredEnv("DISCORD_BOT_TOKEN"));
const clientId = requiredEnv("DISCORD_CLIENT_ID");
const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
await rest.put(route, { body: commands });
console.log(`Registered ${commands.length} commands (${guildId ? `guild ${guildId}` : "global"})`);
