require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  WebhookClient,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const ftp = require("basic-ftp");
const path = require("path");

/* ======================= CONFIGURATION ======================= */

// Licence structure (adjust as needed)
const LICENCES = [
  { name: "Platinum Licence", min: 700, roleId: "1397007839456657478" },
  { name: "Gold Licence", min: 500, roleId: "1396647621187076248" },
  { name: "Silver Licence", min: 200, roleId: "1396647665172742164" },
  { name: "Bronze Licence", min: 0, roleId: "1396647702766420061" },
];

// Channel and role IDs
const LICENCE_CHANNEL_ID = "1397020407701307545"; // #🪪claim-licence
const MOD_CHANNEL_ID = "1397236106881400872"; // #🛠️・mod-tools
const MOD_TOOLS_LOGS_CHANNEL_ID = "1397365113794855033"; // #mod-tools-logs
const MOD_ROLE_IDS = [
  "835038837646295071", // Creator
  "835174572125847612", // Admin
  "950564342015873034", // Moderator
];

// FTP & file settings
const { FTP_HOST = "", FTP_USER = "", FTP_PASS = "" } = process.env;
const LINKED_USERS_FILE = "linked_users.json";
const LICENCE_FILE = "rank.json";
const LOCAL_LICENCE_FILE = path.join(__dirname, LICENCE_FILE);
const SETTINGS_FILE = "leaderboard_settings.json";
const LEADERBOARD_FILE = "leaderboard.json";
const MESSAGE_ID_FILE = "discord_message_id.txt";
const DEFAULT_LEADERBOARD_IMAGE =
  "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png";

/* ===================== END CONFIGURATION ===================== */

// FTP utilities
async function ftpDownload(filename, localPath) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.downloadTo(localPath, filename);
    console.log(`[FTP] Downloaded: ${filename}`);
  } catch (err) {
    console.error("[FTP ERROR] Download failed:", err);
    throw err;
  } finally {
    client.close();
  }
}
async function ftpUpload(localPath, remoteName) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.uploadFrom(localPath, remoteName);
    console.log(`[FTP] Uploaded: ${remoteName}`);
  } catch (err) {
    console.error("[FTP ERROR] Upload failed:", err);
  } finally {
    client.close();
  }
}

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Score formula
function calculateScore(d) {
  const money = d.points ?? 0;
  const wins = d.wins ?? 0;
  const podiums = d.podiums ?? 0;
  const poles = d.poles ?? 0;
  const fastestLaps = d.flaps ?? 0;
  const kilometers = d.kilometers ?? 0;
  const infractions = d.infr ?? 0;
  const crashes = d.crashes ?? 0;
  const infrPer100km = d.infr_per_100km ?? 0;
  const crashesPer100km = d.cr_per_100km ?? 0;
  return (
    money * 0.5 +
    wins * 10 +
    podiums * 8 +
    poles * 15 +
    fastestLaps * 12 +
    kilometers * 0.2 -
    infractions * 2 -
    crashes * 3 -
    infrPer100km * 20 -
    crashesPer100km * 25
  );
}
function getLicence(d) {
  const score = calculateScore(d);
  return LICENCES.find((l) => score >= l.min) || null;
}

// On ready
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Ensure claim button
  try {
    const ch = await client.channels.fetch(LICENCE_CHANNEL_ID);
    const msgs = await ch.messages.fetch({ limit: 50 });
    if (
      !msgs.some(
        (m) =>
          m.author.id === client.user.id &&
          m.content.includes("link your Steam")
      )
    ) {
      const button = new ButtonBuilder()
        .setCustomId("link_steam")
        .setLabel("Link Steam")
        .setStyle(ButtonStyle.Primary);
      await ch.send({
        content: "Link your Steam account:",
        components: [new ActionRowBuilder().addComponents(button)],
      });
    }
  } catch {}
  // Auto mode
  if (process.argv[2] === "auto") {
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(`🚀 Auto run started at ${new Date().toLocaleString()}`);
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllLicences(guild);
    await log.send("✅ Auto-assignment of licences completed");
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    const img = settings.track_image_url?.trim() || DEFAULT_LEADERBOARD_IMAGE;
    await postLeaderboard(settings.track, settings.car, img);
    await log.send(
      `✅ Auto leaderboard updated for **${settings.track}**/${settings.car}`
    );
    process.exit(0);
  }
});

// Interaction: claim button
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton() || i.customId !== "link_steam") return;
  await i.reply({ content: "Check your DM!", ephemeral: true });
  try {
    await i.user.send("Send your Steam64 ID or profile link.");
  } catch {}
});

// DM linking
client.on("messageCreate", async (m) => {
  if (m.channel.type !== 1 || m.author.bot) return;
  const match = m.content.match(/(7656119\d{10,12})/);
  if (!match) return m.reply("Invalid ID");
  const guid = match[1];
  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE))
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE));
  linked[guid] = m.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await m.reply(`Linked ${guid}`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignLicenceToMember(guild, guid, m.author.id);
});

// Mod commands
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || msg.channel.id !== MOD_CHANNEL_ID) return;
  if (!MOD_ROLE_IDS.some((r) => msg.member.roles.cache.has(r))) {
    const r = await msg.reply("No permission.");
    setTimeout(() => {
      r.delete().catch();
      msg.delete().catch();
    }, 8000);
    return;
  }
  // !changetrack
  if (msg.content.startsWith("!changetrack")) {
    const [, , track, car, ...img] = msg.content.split(/ +/);
    if (!track || !car) {
      const r = await msg.reply(
        "Usage: !changetrack <track> <car> [image_url]"
      );
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
      return;
    }
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ track, car, track_image_url: img.join(" ") }, null, 2)
    );
    const r = await msg.reply(`Settings updated: **${track}**/**${car}**`);
    setTimeout(() => {
      r.delete().catch();
      msg.delete().catch();
    }, 8000);
    return;
  }
  // !assignlicences
  if (msg.content.startsWith("!assignlicences")) {
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(
      `🛠️ Manual assignLicences by <@${
        msg.author.id
      }> at ${new Date().toLocaleString()}`
    );
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllLicences(guild);
    await log.send(`✅ Manual assignLicences completed by <@${msg.author.id}>`);
    const r = await msg.reply("All linked members have now been licenced!");
    setTimeout(() => {
      r.delete().catch();
      msg.delete().catch();
    }, 8000);
    return;
  }
  // !updateleaderboard
  if (msg.content.startsWith("!updateleaderboard")) {
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(
      `🛠️ Manual leaderboard update by <@${
        msg.author.id
      }> at ${new Date().toLocaleString()}`
    );
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    } catch {
      const r = await msg.reply("No settings. Use !changetrack.");
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
      return;
    }
    const imageUrl =
      settings.track_image_url?.trim() || DEFAULT_LEADERBOARD_IMAGE;
    try {
      await postLeaderboard(settings.track, settings.car, imageUrl, msg);
      await log.send(
        `✅ Manual leaderboard updated by <@${msg.author.id}> for **${settings.track}**/**${settings.car}**`
      );
      const r = await msg.reply("Leaderboard updated!");
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
    } catch (err) {
      console.error(err);
      const r = await msg.reply("Error: " + err.message);
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
    }
    return;
  }
  // !achelp
  if (msg.content.startsWith("!achelp")) {
    try {
      await msg.author.send(
        `Commands:\n!changetrack\n!assignlicences\n!updateleaderboard\n!achelp`
      );
      if (msg.channel.type !== 1) {
        const r = await msg.reply("Help sent via DM!");
        setTimeout(() => {
          r.delete().catch();
          msg.delete().catch();
        }, 8000);
      }
    } catch {
      const r = await msg.reply("Couldn't DM.");
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
    }
    return;
  }
});

// assign single
async function assignLicenceToMember(guild, guid, did) {
  try {
    await ftpDownload(LICENCE_FILE, LOCAL_LICENCE_FILE);
  } catch {
    return;
  }
  if (!fs.existsSync(LOCAL_LICENCE_FILE)) return;
  const data = JSON.parse(fs.readFileSync(LOCAL_LICENCE_FILE));
  const driver = data.find((d) => d.guid === guid);
  if (!driver) return;
  const lic = getLicence(driver);
  if (!lic) return;
  const score = calculateScore(driver);
  const parts = [
    `money:${driver.points || 0}*0.5=${((driver.points || 0) * 0.5).toFixed(
      2
    )}`,
    `wins:${driver.wins || 0}*10=${((driver.wins || 0) * 10).toFixed(2)}`,
    `podiums:${driver.podiums || 0}*8=${((driver.podiums || 0) * 8).toFixed(
      2
    )}`,
    `poles:${driver.poles || 0}*15=${((driver.poles || 0) * 15).toFixed(2)}`,
    `flaps:${driver.flaps || 0}*12=${((driver.flaps || 0) * 12).toFixed(2)}`,
    `kms:${driver.kilometers || 0}*0.2=${(
      (driver.kilometers || 0) * 0.2
    ).toFixed(2)}`,
    `infr:-${driver.infr || 0}*2=${(-(driver.infr || 0) * 2).toFixed(2)}`,
    `crashes:-${driver.crashes || 0}*3=${(-(driver.crashes || 0) * 3).toFixed(
      2
    )}`,
    `infr/100:${driver.infr_per_100km || 0}*20=${(
      -(driver.infr_per_100km || 0) * 20
    ).toFixed(2)}`,
    `cr/100:${driver.cr_per_100km || 0}*25=${(
      -(driver.cr_per_100km || 0) * 25
    ).toFixed(2)}`,
  ];
  const breakdown = parts.join(", ");
  const member = await guild.members.fetch(did).catch(() => null);
  if (!member) return;
  await member.roles.remove(LICENCES.map((l) => l.roleId)).catch(() => {});
  await member.roles.add(lic.roleId).catch(() => {});
  const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
  await log.send(
    `Assigned **${lic.name}** to <@${did}> (score: ${score.toFixed(
      2
    )}). Breakdown: ${breakdown}`
  );
}

// assign all
async function assignAllLicences(guild) {
  try {
    await ftpDownload(LICENCE_FILE, LOCAL_LICENCE_FILE);
  } catch {
    return;
  }
  if (!fs.existsSync(LOCAL_LICENCE_FILE)) return;
  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE));
  const data = JSON.parse(fs.readFileSync(LOCAL_LICENCE_FILE));
  for (const [guid, did] of Object.entries(linked)) {
    const driver = data.find((d) => d.guid === guid);
    if (!driver) continue;
    const lic = getLicence(driver);
    if (!lic) continue;
    const score = calculateScore(driver);
    const member = await guild.members.fetch(did).catch(() => null);
    if (!member) continue;
    await member.roles.remove(LICENCES.map((l) => l.roleId)).catch(() => {});
    await member.roles.add(lic.roleId).catch(() => {});
    const parts = [
      `money:${driver.points || 0}*0.5=${((driver.points || 0) * 0.5).toFixed(
        2
      )}`,
      `wins:${driver.wins || 0}*10=${((driver.wins || 0) * 10).toFixed(2)}`,
      `podiums:${driver.podiums || 0}*8=${((driver.podiums || 0) * 8).toFixed(
        2
      )}`,
      `poles:${driver.poles || 0}*15=${((driver.poles || 0) * 15).toFixed(2)}`,
      `flaps:${driver.flaps || 0}*12=${((driver.flaps || 0) * 12).toFixed(2)}`,
      `kms:${driver.kilometers || 0}*0.2=${(
        (driver.kilometers || 0) * 0.2
      ).toFixed(2)}`,
      `infr:-${driver.infr || 0}*2=${(-(driver.infr || 0) * 2).toFixed(2)}`,
      `crashes:-${driver.crashes || 0}*3=${(-(driver.crashes || 0) * 3).toFixed(
        2
      )}`,
      `infr/100:${driver.infr_per_100km || 0}*20=${(
        -(driver.infr_per_100km || 0) * 20
      ).toFixed(2)}`,
      `cr/100:${driver.cr_per_100km || 0}*25=${(
        -(driver.cr_per_100km || 0) * 25
      ).toFixed(2)}`,
    ];
    const breakdown = parts.join(", ");
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(
      `Auto-assigned **${lic.name}** to <@${did}> (score: ${score.toFixed(
        2
      )}). Breakdown: ${breakdown}`
    );
  }
}

// leaderboard
async function postLeaderboard(track, car, imageUrl, msg = null) {
  await ftpDownload(LEADERBOARD_FILE, path.join(__dirname, LEADERBOARD_FILE));
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, LEADERBOARD_FILE))
  );
  const lb = (data[track]?.[car] || []).sort((a, b) => a.laptime - b.laptime);
  let desc = `**Track:** \`${track}\`\n**Car:** \`${car}\`\n\n**Top 10:**\n`;
  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
  lb.slice(0, 10).forEach((e, i) => {
    const place = i + 1;
    const m = medals[place] || "";
    const ms = e.laptime || 0;
    const min = Math.floor(ms / 60000);
    const sec = ((ms / 1000) % 60).toFixed(3).padStart(6, "0");
    desc += `${place}. \`${min}:${sec}\` — **${
      e.name?.slice(0, 30) || "Unknown"
    }** ${m}\n`;
  });
  const embed = new EmbedBuilder()
    .setAuthor({
      name: "🏆 KMR Leaderboard",
      iconURL: DEFAULT_LEADERBOARD_IMAGE,
      url: "https://acstuff.ru/",
    })
    .setTitle("AC Elite Server")
    .setDescription(desc)
    .setColor(0xff0000)
    .setThumbnail(DEFAULT_LEADERBOARD_IMAGE)
    .setFooter({
      text: "Data by AC Elite Leaderboard",
      iconURL: DEFAULT_LEADERBOARD_IMAGE,
    })
    .setTimestamp();
  const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

  let id = null;
  try {
    const tmp = path.join(__dirname, "__mid.tmp");
    await ftpDownload(MESSAGE_ID_FILE, tmp);
    id = fs.readFileSync(tmp, "utf8").trim();
    fs.unlinkSync(tmp);
  } catch {}

  if (id) {
    try {
      await webhook.editMessage(id, { embeds: [embed] });
      console.log(`Edited leaderboard ${id}`);
      return;
    } catch (err) {
      if (err.code !== 10008) throw err;
    }
  }

  const sent = await webhook.send({ embeds: [embed] });
  fs.writeFileSync(path.join(__dirname, MESSAGE_ID_FILE), sent.id);
  await ftpUpload(path.join(__dirname, MESSAGE_ID_FILE), MESSAGE_ID_FILE);
  console.log(`Posted new leaderboard ${sent.id}`);
}

client.login(process.env.DISCORD_BOT_TOKEN);
