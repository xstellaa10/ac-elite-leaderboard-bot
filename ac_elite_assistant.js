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

// Channel and role IDs (FILL THESE IN for your server)
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
const LICENCE_FILE = "rank.json"; // FTP bestand
const LOCAL_LICENCE_FILE = path.join(__dirname, LICENCE_FILE);
const SETTINGS_FILE = "leaderboard_settings.json";
const LEADERBOARD_FILE = "leaderboard.json";
const MESSAGE_ID_FILE = "discord_message_id.txt";
const DEFAULT_LEADERBOARD_IMAGE =
  "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png";

/* ============ END CONFIGURATION ============ */

// FTP download utility
async function ftpDownload(filename, localPath) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.downloadTo(localPath, filename);
    console.log(`[FTP] Downloaded: ${filename} -> ${localPath}`);
  } catch (err) {
    console.error("[FTP ERROR] Download failed:", err);
    throw err;
  } finally {
    client.close();
  }
}

// FTP upload utility (for message id)
async function ftpUpload(localPath, remoteName) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.uploadFrom(localPath, remoteName);
    console.log(`[FTP] Uploaded: ${localPath} -> ${remoteName}`);
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

/* === SCORE FORMULA: bereken de score voor licentie === */
function calculateScore(driver) {
  const money = typeof driver.points === "number" ? driver.points : 0;
  const wins = typeof driver.wins === "number" ? driver.wins : 0;
  const podiums = typeof driver.podiums === "number" ? driver.podiums : 0;
  const poles = typeof driver.poles === "number" ? driver.poles : 0;
  const fastestLaps = typeof driver.flaps === "number" ? driver.flaps : 0;
  const kilometers =
    typeof driver.kilometers === "number" ? driver.kilometers : 0;
  const infractions = typeof driver.infr === "number" ? driver.infr : 0;
  const crashes = typeof driver.crashes === "number" ? driver.crashes : 0;
  const infrPer100km =
    typeof driver.infr_per_100km === "number" ? driver.infr_per_100km : 0;
  const crashesPer100km =
    typeof driver.cr_per_100km === "number" ? driver.cr_per_100km : 0;

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

function getLicence(driver) {
  const score = calculateScore(driver);
  return LICENCES.find((lic) => score >= lic.min) || null;
}

// On ready: auto-place claim button in the correct channel
client.once("ready", async () => {
  console.log(`✅ AC Elite Assistant online as ${client.user.tag}`);

  // Ensure claim button exists
  try {
    const channel = await client.channels.fetch(LICENCE_CHANNEL_ID);
    if (channel) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const alreadySent = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.content.includes("link your Steam account")
      );
      if (!alreadySent) {
        const button = new ButtonBuilder()
          .setCustomId("link_steam")
          .setLabel("Link Steam")
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(button);
        await channel.send({
          content:
            "Do you want to link your Steam account to Discord? Click below.",
          components: [row],
        });
        console.log(`[INFO] Claim message sent in #${channel.name}`);
      }
    }
  } catch (err) {
    console.error("[ERROR] While auto-placing button:", err);
  }

  // AUTO MODE for cron (every 15/30 min) to update licences & leaderboard
  if (process.argv[2] === "auto") {
    const logChan = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await logChan.send(`🚀 Auto run started at ${new Date().toLocaleString()}`);

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllLicences(guild);
    await logChan.send("[AUTO] All linked members have now been licenced!");

    // Leaderboard
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    const imageUrl =
      settings.track_image_url?.trim() || DEFAULT_LEADERBOARD_IMAGE;
    await postLeaderboard(settings.track, settings.car, imageUrl);
    await logChan.send(
      `✅ Leaderboard updated for track **${settings.track}** and car **${settings.car}**.`
    );

    process.exit(0);
  }
});

/* === Claim Button click: Send DM for linking === */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "link_steam") return;
  await interaction.reply({ content: "Check your DM! ✉️", ephemeral: true });
  try {
    await interaction.user.send(
      "Hi! Please send your **Steam profile link** or **Steam64 ID** (GUID) to link your Discord account."
    );
    console.log(`[INFO] DM sent to ${interaction.user.tag}`);
  } catch (err) {
    await interaction.followUp({
      content: "Could not send DM. Enable DMs or contact admin.",
      ephemeral: true,
    });
    console.error(`[ERROR] DM to ${interaction.user.tag}:`, err);
  }
});

/* === Process DMs: Link and assign licence === */
client.on("messageCreate", async (msg) => {
  if (msg.channel.type !== 1 || msg.author.bot) return;
  const match = msg.content.match(/(7656119\d{10,12})/);
  if (!match) {
    return msg.reply(
      "Invalid Steam64 ID. Send your 17-digit GUID or full profile link."
    );
  }
  const steamGuid = match[1];

  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  }
  const already = Object.values(linked).includes(msg.author.id);
  if (already && linked[steamGuid] === msg.author.id) {
    return msg.reply(`GUID \`${steamGuid}\` already linked.`);
  }

  linked[steamGuid] = msg.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await msg.reply(`Success! GUID \`${steamGuid}\` linked. Assigning role now.`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignLicenceToMember(guild, steamGuid, msg.author.id);
});

/* === MOD/ADMIN COMMANDS: in mod-tools channel only === */
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || msg.channel.id !== MOD_CHANNEL_ID) return;
  const allowed = MOD_ROLE_IDS.some((r) => msg.member.roles.cache.has(r));
  if (!allowed) {
    const r = await msg.reply("You do not have permission.");
    setTimeout(() => {
      r.delete().catch(() => {});
      msg.delete().catch(() => {});
    }, 8000);
    return;
  }

  // !changetrack
  if (msg.content.startsWith("!changetrack")) {
    const parts = msg.content.split(/ +/).slice(1);
    if (parts.length < 2) {
      const r = await msg.reply(
        "Usage: `!changetrack <track> <car> [image_url]`"
      );
      setTimeout(() => {
        r.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 8000);
      return;
    }
    const [track, car, ...img] = parts;
    const newSet = { track, car, track_image_url: img.join(" ") };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSet, null, 2));
    const r = await msg.reply(
      `✅ Leaderboard settings updated! Track: \`${track}\`, Car: \`${car}\``
    );
    setTimeout(() => {
      r.delete().catch(() => {});
      msg.delete().catch(() => {});
    }, 8000);
    return;
  }

  // !assignlicences
  if (msg.content.startsWith("!assignlicences")) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllLicences(guild);
    const r = await msg.reply("All linked members have now been licenced!");
    setTimeout(() => {
      r.delete().catch(() => {});
      msg.delete().catch(() => {});
    }, 8000);
    return;
  }

  // !updateleaderboard
  if (msg.content.startsWith("!updateleaderboard")) {
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {
      const r = await msg.reply(
        "No leaderboard settings. Use !changetrack first."
      );
      setTimeout(() => {
        r.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 8000);
      return;
    }
    const imageUrl =
      settings.track_image_url?.trim() || DEFAULT_LEADERBOARD_IMAGE;
    try {
      await postLeaderboard(settings.track, settings.car, imageUrl, msg);
      const r = await msg.reply("Leaderboard updated!");
      setTimeout(() => {
        r.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 8000);
    } catch (err) {
      console.error("[ERROR] Leaderboard update:", err);
      const r = await msg.reply("Error updating leaderboard: " + err.message);
      setTimeout(() => {
        r.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 8000);
    }
    return;
  }

  // !achelp
  if (msg.content.startsWith("!achelp")) {
    const help = `**AC Elite Assistant Commands:**
• \`!changetrack <track> <car> [image_url]\`
• \`!assignlicences\`
• \`!updateleaderboard\`
• \`!achelp\``;
    try {
      await msg.author.send(help);
      if (msg.channel.type !== 1) {
        const r = await msg.reply("📩 Help sent via DM!");
        setTimeout(() => {
          r.delete().catch(() => {});
          msg.delete().catch(() => {});
        }, 8000);
      }
    } catch {
      const r = await msg.reply("⚠️ Couldn't send DM. Check privacy settings.");
      setTimeout(() => {
        r.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 8000);
    }
    return;
  }
});

// Assign a single member and log breakdown
async function assignLicenceToMember(guild, steamGuid, discordId) {
  try {
    await ftpDownload(LICENCE_FILE, LOCAL_LICENCE_FILE);
  } catch {
    return;
  }
  if (!fs.existsSync(LOCAL_LICENCE_FILE)) return;
  const data = JSON.parse(fs.readFileSync(LOCAL_LICENCE_FILE, "utf8"));
  const driver = data.find((r) => r.guid === steamGuid);
  if (!driver) return;
  const licence = getLicence(driver);
  if (!licence) return;

  // Destructure for breakdown
  const {
    points: money = 0,
    wins = 0,
    podiums = 0,
    poles = 0,
    flaps: fastestLaps = 0,
    kilometers = 0,
    infr: infractions = 0,
    crashes = 0,
    infr_per_100km: infrPer100km = 0,
    cr_per_100km: crashesPer100km = 0,
  } = driver;
  const score = calculateScore(driver);
  const breakdown = [
    `money:${money}*0.5=${(money * 0.5).toFixed(2)}`,
    `wins:${wins}*10=${(wins * 10).toFixed(2)}`,
    `podiums:${podiums}*8=${(podiums * 8).toFixed(2)}`,
    `poles:${poles}*15=${(poles * 15).toFixed(2)}`,
    `fastestLaps:${fastestLaps}*12=${(fastestLaps * 12).toFixed(2)}`,
    `kilometers:${kilometers}*0.2=${(kilometers * 0.2).toFixed(2)}`,
    `infractions:-${infractions}*2=${(-infractions * 2).toFixed(2)}`,
    `crashes:-${crashes}*3=${(-crashes * 3).toFixed(2)}`,
    `infrPer100km:-${infrPer100km}*20=${(-infrPer100km * 20).toFixed(2)}`,
    `crashesPer100km:-${crashesPer100km}*25=${(-crashesPer100km * 25).toFixed(
      2
    )}`,
  ].join(", ");

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return;
  await member.roles.remove(LICENCES.map((r) => r.roleId)).catch(() => {});
  await member.roles.add(licence.roleId).catch(() => {});

  // Send log to mod-tools-logs
  const logChan = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
  await logChan.send(
    `Assigned **${licence.name}** to <@${discordId}> (score: ${score.toFixed(
      2
    )}). Breakdown: ${breakdown}`
  );
}

// Assign all linked members and log each
async function assignAllLicences(guild) {
  try {
    await ftpDownload(LICENCE_FILE, LOCAL_LICENCE_FILE);
  } catch {
    console.error("[ERROR] Could not download rank.json.");
    return;
  }
  if (!fs.existsSync(LOCAL_LICENCE_FILE)) return;

  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(LOCAL_LICENCE_FILE, "utf8"));

  for (const [steamGuid, discordId] of Object.entries(linked)) {
    const driver = data.find((r) => r.guid === steamGuid);
    if (!driver) continue;
    const licence = getLicence(driver);
    if (!licence) continue;

    // compute breakdown
    const {
      points: money = 0,
      wins = 0,
      podiums = 0,
      poles = 0,
      flaps: fastestLaps = 0,
      kilometers = 0,
      infr: infractions = 0,
      crashes = 0,
      infr_per_100km: infrPer100km = 0,
      cr_per_100km: crashesPer100km = 0,
    } = driver;
    const score = calculateScore(driver);
    const breakdown = [
      `money:${money}*0.5=${(money * 0.5).toFixed(2)}`,
      `wins:${wins}*10=${(wins * 10).toFixed(2)}`,
      `podiums:${podiums}*8=${(podiums * 8).toFixed(2)}`,
      `poles:${poles}*15=${(poles * 15).toFixed(2)}`,
      `fastestLaps:${fastestLaps}*12=${(fastestLaps * 12).toFixed(2)}`,
      `kilometers:${kilometers}*0.2=${(kilometers * 0.2).toFixed(2)}`,
      `infractions:-${infractions}*2=${(-infractions * 2).toFixed(2)}`,
      `crashes:-${crashes}*3=${(-crashes * 3).toFixed(2)}`,
      `infrPer100km:-${infrPer100km}*20=${(-infrPer100km * 20).toFixed(2)}`,
      `crashesPer100km:-${crashesPer100km}*25=${(-crashesPer100km * 25).toFixed(
        2
      )}`,
    ].join(", ");

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;
    await member.roles.remove(LICENCES.map((r) => r.roleId)).catch(() => {});
    await member.roles.add(licence.roleId).catch(() => {});

    // log each assignment
    const logChan = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await logChan.send(
      `Auto-assigned **${
        licence.name
      }** to <@${discordId}> (score: ${score.toFixed(
        2
      )}). Breakdown: ${breakdown}`
    );
  }
}

/* === Leaderboard post function === */
async function postLeaderboard(track, car, imageUrl, msg = null) {
  await ftpDownload(LEADERBOARD_FILE, path.join(__dirname, LEADERBOARD_FILE));
  const raw = fs.readFileSync(path.join(__dirname, LEADERBOARD_FILE), "utf8");
  const data = JSON.parse(raw);
  const lb = data[track]?.[car] || [];
  lb.sort((a, b) => a.laptime - b.laptime);

  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
  let description = `**Track:** \`${track}\`\n**Car:** \`${car}\`\n\n**Top 10:**\n`;
  lb.slice(0, 10).forEach((e, i) => {
    const place = i + 1;
    const m = medals[place] || "";
    const name = e.name?.slice(0, 30) || "Unknown";
    const ms = e.laptime || 0;
    const min = Math.floor(ms / 1000 / 60);
    const sec = ((ms / 1000) % 60).toFixed(3).padStart(6, "0");
    description += `${place}. \`${min}:${sec}\` — **${name}** ${m}\n`;
  });

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "🏆 KMR Leaderboard",
      url: "https://acstuff.ru/",
      iconURL: DEFAULT_LEADERBOARD_IMAGE,
    })
    .setTitle("AC Elite Server")
    .setColor(0xff0000)
    .setThumbnail(DEFAULT_LEADERBOARD_IMAGE)
    .setDescription(description)
    .setFooter({
      text: "Data by AC Elite Leaderboard",
      iconURL: DEFAULT_LEADERBOARD_IMAGE,
    })
    .setTimestamp();

  const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

  // Manage existing message via FTP-stored ID
  let savedId = null;
  try {
    const tmpIdFile = path.join(__dirname, "__mid.tmp");
    await ftpDownload(MESSAGE_ID_FILE, tmpIdFile);
    savedId = fs.readFileSync(tmpIdFile, "utf8").trim();
    fs.unlinkSync(tmpIdFile);
  } catch {}

  if (savedId) {
    try {
      await webhook.editMessage(savedId, { embeds: [embed] });
      console.log(`✅ Edited leaderboard message ${savedId}`);
      return;
    } catch (err) {
      if (err.code !== 10008) throw err;
    }
  }
  const sent = await webhook.send({ embeds: [embed] });
  fs.writeFileSync(path.join(__dirname, MESSAGE_ID_FILE), sent.id);
  await ftpUpload(path.join(__dirname, MESSAGE_ID_FILE), MESSAGE_ID_FILE);
  console.log(`✅ Posted new leaderboard message ${sent.id}`);
}

client.login(process.env.DISCORD_BOT_TOKEN);
