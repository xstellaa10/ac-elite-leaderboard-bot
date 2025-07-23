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

// Rank structure (adjust as needed)
const RANKS = [
  { name: "Platinum Licence", min: 1000, roleId: "1397007839456657478" },
  { name: "Gold Licence", min: 700, roleId: "1396647621187076248" },
  { name: "Silver Licence", min: 300, roleId: "1396647665172742164" },
  { name: "Bronze Licence", min: 0, roleId: "1396647702766420061" },
];

// Channel and role IDs (FILL THESE IN for your server)
const RANK_CHANNEL_ID = "1397020407701307545"; // Channel for claim button (e.g. #🪪claim-licence)
const MOD_CHANNEL_ID = "1397236106881400872"; // Channel for mod commands (e.g. #🛠️・mod-tools)
const MOD_LOG_CHANNEL_ID = "1397365113794855033"; // Channel for mod command logs
const MOD_ROLE_IDS = [
  "835038837646295071", // Creator
  "835174572125847612", // Admin
  "950564342015873034", // Moderator
];

// FTP & file settings
const { FTP_HOST = "", FTP_USER = "", FTP_PASS = "" } = process.env;
const LINKED_USERS_FILE = "linked_users.json";
const RANK_FILE = "rank.json";
const LOCAL_RANK_FILE = path.join(__dirname, RANK_FILE);
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

// === SCORING FORMULA (update here to tweak weighting) ===
function calculateScore(driver) {
  // Defaults for undefined values:
  const points = Number(driver.points) || 0;
  const wins = Number(driver.wins) || 0;
  const podiums = Number(driver.podiums) || 0;
  const poles = Number(driver.poles) || 0;
  const flaps =
    Number(driver.flaps || driver.fastestlaps || driver.fastest_laps) || 0;
  const kilometers = Number(driver.kilometers) || 0;
  const infractions = Number(driver.infr || driver.infractions) || 0;
  const crashes = Number(driver.collisions || driver.crashes) || 0;

  // Derived stats:
  const infractionsPer100km =
    kilometers > 0 ? infractions / (kilometers / 100) : 0;
  const crashesPer100km = kilometers > 0 ? crashes / (kilometers / 100) : 0;

  // Weighted scoring formula (feel free to tweak!)
  return (
    points +
    wins * 10 +
    podiums * 6 +
    poles * 8 +
    flaps * 8 +
    kilometers * 0.1 -
    infractionsPer100km * 5 -
    crashesPer100km * 10 -
    infractions * 0.2 -
    crashes * 0.5
  );
}

// Helper: determine rank
function getRank(driver) {
  const score = calculateScore(driver);
  const found = RANKS.find((rank) => score >= rank.min);
  return found ? { ...found, score } : null;
}

// On ready: auto-place claim button in the correct channel
client.once("ready", async () => {
  console.log(`✅ AC Elite Assistant online as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(RANK_CHANNEL_ID);
    if (!channel) {
      console.log("[ERROR] Claim channel not found!");
    } else {
      const messages = await channel.messages.fetch({ limit: 50 });
      const alreadySent = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.content.includes("Do you want to link your Steam account")
      );
      if (!alreadySent) {
        const button = new ButtonBuilder()
          .setCustomId("link_steam")
          .setLabel("Link Steam")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({
          content:
            "Do you want to link your Steam account to Discord? Click the button below.\n\nAfter linking, you will automatically receive a rank role based on your stats!",
          components: [row],
        });
        console.log(
          `[INFO] Claim message sent in #${channel.name} (${channel.id})`
        );
      } else {
        console.log(
          `[INFO] Claim message already exists in #${channel.name} (${channel.id})`
        );
      }
    }
  } catch (err) {
    console.log("[ERROR] Error while auto-placing button:", err);
  }

  // AUTO MODE for cron (every 15 min) to update ranks
  if (process.argv[2] === "auto") {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllRanks(guild);
    console.log("[AUTO] All linked members have now been ranked!");
    process.exit(0);
  }
});

/* === Claim Button click: Send DM for linking === */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "link_steam") return;

  await interaction.reply({
    content: "Check your DM! ✉️",
    ephemeral: true,
  });

  // Send DM
  try {
    await interaction.user.send(
      "Hi! Please send your **Steam profile link** or **Steam64 ID** (GUID) to link your Discord account.\n" +
        "Example:\n`76561198000000000` or `https://steamcommunity.com/profiles/76561198000000000`"
    );
    console.log(`[INFO] DM sent to ${interaction.user.tag} for linking`);
  } catch (err) {
    await interaction.followUp({
      content:
        "Could not send you a DM! Please enable DMs or contact an admin.",
      ephemeral: true,
    });
    console.log(`[ERROR] Could not DM ${interaction.user.tag}:`, err);
  }
});

/* === Process DMs: Link and assign rank === */
client.on("messageCreate", async (msg) => {
  // Only react to DMs not sent by the bot itself
  if (msg.channel.type !== 1 || msg.author.bot) return;

  const match = msg.content.match(/(7656119\d{10,12})/);
  if (!match) {
    await msg.reply(
      "Invalid Steam64 ID. Please only send your 17-digit Steam64 ID or full Steam profile link."
    );
    return;
  }
  const steamGuid = match[1];

  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  }

  // Already linked?
  const alreadyLinked = Object.values(linked).includes(msg.author.id);
  if (
    alreadyLinked &&
    Object.entries(linked).find(
      ([guid, did]) => did === msg.author.id && guid === steamGuid
    )
  ) {
    await msg.reply(
      `Your Steam GUID \`${steamGuid}\` is already linked to your Discord account.`
    );
    return;
  }

  // Save new or changed link
  linked[steamGuid] = msg.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await msg.reply(
    `Success! Your Steam GUID \`${steamGuid}\` is now linked to your Discord account. You will automatically get your correct role!`
  );
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignRankToMember(guild, steamGuid, msg.author.id);
});

/* === MOD/ADMIN COMMANDS: in mod-tools channel only === */
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== MOD_CHANNEL_ID) return;

  // Check: user has one of the allowed roles
  const allowed = MOD_ROLE_IDS.some((roleId) =>
    msg.member.roles.cache.has(roleId)
  );
  if (!allowed) {
    msg.reply("You do not have permission to use bot moderator commands.");
    return;
  }

  // !changetrack <track> [car]
  if (msg.content.startsWith("!changetrack")) {
    const args = msg.content.split(" ");
    if (args.length < 2) {
      msg.reply("Usage: `!changetrack <track> [car]`");
      return;
    }
    const [, track, carArg] = args;
    const car = carArg || "tatuusfa1";
    const newSettings = { track, car };
    fs.writeFileSync(
      path.join(__dirname, SETTINGS_FILE),
      JSON.stringify(newSettings, null, 2)
    );
    msg.reply(
      `✅ Leaderboard settings updated!\n**Track:** \`${track}\`\n**Car:** \`${car}\``
    );
    logModAction(
      msg,
      `[MOD] Settings updated by ${msg.author.tag}: ${JSON.stringify(
        newSettings
      )}`
    );
    setTimeout(() => msg.delete().catch(() => {}), 7000);
    return;
  }

  // !assignranks (manual assign)
  if (msg.content.startsWith("!assignranks")) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllRanks(guild);
    msg
      .reply("All linked members have now been ranked!")
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000));
    setTimeout(() => msg.delete().catch(() => {}), 7000);
    logModAction(msg, `[MOD] !assignranks used by ${msg.author.tag}`);
    return;
  }

  // !updateleaderboard (manual leaderboard post)
  if (msg.content.startsWith("!updateleaderboard")) {
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch (e) {
      msg
        .reply("No leaderboard settings found. Use !changetrack first.")
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000));
      setTimeout(() => msg.delete().catch(() => {}), 7000);
      return;
    }
    if (!settings.track || !settings.car) {
      msg
        .reply("Track or car not set. Use !changetrack <track> [car] first.")
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000));
      setTimeout(() => msg.delete().catch(() => {}), 7000);
      return;
    }

    postLeaderboard(settings.track, settings.car, msg)
      .then(() => {
        msg
          .reply("Leaderboard updated!")
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000));
        setTimeout(() => msg.delete().catch(() => {}), 7000);
        logModAction(msg, `[MOD] !updateleaderboard used by ${msg.author.tag}`);
      })
      .catch((err) => {
        msg
          .reply("Error updating leaderboard: " + (err.message || err))
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000));
        setTimeout(() => msg.delete().catch(() => {}), 7000);
        console.error("[ERROR] Leaderboard update:", err);
      });
    return;
  }

  // !achelp
  if (msg.content.trim() === "!achelp") {
    msg
      .reply(
        "**AC Elite Assistant Moderator Commands:**\n" +
          "• `!changetrack <track> [car]` — Change the leaderboard to a different track and car (default car: tatuusfa1)\n" +
          "• `!updateleaderboard` — Manually update leaderboard post (after changetrack or if you want to refresh)\n" +
          "• `!assignranks` — Manually update all Discord roles/licenses for all linked users\n" +
          "All moderator commands will be removed automatically for a clean channel. Full logs appear in <#1397365113794855033>."
      )
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 25000));
    setTimeout(() => msg.delete().catch(() => {}), 7000);
    return;
  }
});

// Logging helper for mod actions
async function logModAction(msg, text) {
  try {
    const logChannel = await msg.guild.channels.fetch(MOD_LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send(`[LOG] ${text}`);
    }
  } catch (e) {
    console.log("[LOG] Could not send to mod-tools-logs channel.");
  }
}

/* === Rank assignment functions === */
async function assignRankToMember(guild, steamGuid, discordId) {
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Could not download rank.json.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) return;
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));
  const driver = data.find((r) => r.guid === steamGuid);
  if (!driver) return;

  const rank = getRank(driver);
  if (!rank) return;

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return;

  await member.roles.remove(RANKS.map((r) => r.roleId)).catch(() => {});
  await member.roles.add(rank.roleId).catch(() => {});

  // Log to console (for stats fine-tuning!)
  console.log(
    `[RESULT] ${driver.name} (${steamGuid}) | points=${driver.points}, wins=${
      driver.wins
    }, podiums=${driver.podiums}, poles=${driver.poles}, flaps=${
      driver.flaps
    }, km=${driver.kilometers}, infr=${driver.infr}, crashes=${
      driver.collisions
    }, infr/100km=${
      driver.kilometers > 0
        ? (driver.infr / (driver.kilometers / 100)).toFixed(2)
        : "0"
    }, cr/100km=${
      driver.kilometers > 0
        ? (driver.collisions / (driver.kilometers / 100)).toFixed(2)
        : "0"
    }, avg=${rank.score} => ${rank.name}`
  );
}

async function assignAllRanks(guild) {
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Could not download rank.json.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) return;

  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));

  for (const [steamGuid, discordId] of Object.entries(linked)) {
    const driver = data.find((r) => r.guid === steamGuid);
    if (!driver) continue;
    const rank = getRank(driver);
    if (!rank) continue;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;
    await member.roles.remove(RANKS.map((r) => r.roleId)).catch(() => {});
    await member.roles.add(rank.roleId).catch(() => {});

    // Log for each driver
    console.log(
      `[RESULT] ${driver.name} (${steamGuid}) | points=${driver.points}, wins=${
        driver.wins
      }, podiums=${driver.podiums}, poles=${driver.poles}, flaps=${
        driver.flaps
      }, km=${driver.kilometers}, infr=${driver.infr}, crashes=${
        driver.collisions
      }, infr/100km=${
        driver.kilometers > 0
          ? (driver.infr / (driver.kilometers / 100)).toFixed(2)
          : "0"
      }, cr/100km=${
        driver.kilometers > 0
          ? (driver.collisions / (driver.kilometers / 100)).toFixed(2)
          : "0"
      }, avg=${rank.score} => ${rank.name}`
    );
  }
}

/* === Leaderboard post function === */
async function postLeaderboard(track, car, msg = null) {
  await ftpDownload(LEADERBOARD_FILE, path.join(__dirname, LEADERBOARD_FILE));
  const raw = fs.readFileSync(path.join(__dirname, LEADERBOARD_FILE), "utf8");
  const data = JSON.parse(raw);
  const lb = data[track]?.[car] || [];

  lb.sort((a, b) => a.laptime - b.laptime);
  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

  let description =
    `**Track:** \`${track}\`\n` + `**Car:** \`${car}\`\n\n` + `**Top 10:**\n`;

  lb.slice(0, 10).forEach((entry, idx) => {
    const place = idx + 1;
    const medal = medals[place] || "";
    const name = entry.name?.slice(0, 30) || "Unknown";
    const laptime = entry.laptime || 0;
    const min = Math.floor(laptime / 1000 / 60);
    const sec = ((laptime / 1000) % 60).toFixed(3).padStart(6, "0");
    description += `${place}. \`${min}:${sec}\` — **${name}**${
      medal ? " " + medal : ""
    }\n`;
  });

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "🏆 KMR Leaderboard",
      url: "https://acstuff.ru/s/q:race/online/join?httpPort=18283&ip=157.90.3.32",
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

  // Get webhook from env
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  const webhook = new WebhookClient({ url: webhookUrl });

  // Get or create message id file
  let savedId = null;
  try {
    const tmp = path.join(__dirname, "__mid.tmp");
    await ftpDownload(MESSAGE_ID_FILE, tmp);
    savedId = fs.readFileSync(tmp, "utf8").trim();
    fs.unlinkSync(tmp);
  } catch {}
  // Update or create message
  if (savedId) {
    try {
      await webhook.editMessage(savedId, { embeds: [embed] });
      console.log(`✅ Edited leaderboard message ${savedId}`);
      return;
    } catch (err) {
      if (err.code !== 10008) {
        throw err;
      }
      // else: message not found, fall through to create
    }
  }
  const sent = await webhook.send({ embeds: [embed] });
  fs.writeFileSync(path.join(__dirname, MESSAGE_ID_FILE), sent.id);
  // Optionally upload new id via ftp
  await ftpUpload(path.join(__dirname, MESSAGE_ID_FILE), MESSAGE_ID_FILE);
  console.log(`✅ Posted new leaderboard message ${sent.id}`);
}

client.login(process.env.DISCORD_BOT_TOKEN);
