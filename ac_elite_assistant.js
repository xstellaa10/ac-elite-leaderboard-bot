require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require("discord.js");
const fs = require("fs");
const ftp = require("basic-ftp");
const path = require("path");

/* ======================= CONFIGURATION ======================= */

// Rank structure: add or change as needed
const RANKS = [
  { name: "Platinum Licence", min: 700, roleId: "1397007839456657478" },
  { name: "Gold Licence", min: 500, roleId: "1396647621187076248" },
  { name: "Silver Licence", min: 200, roleId: "1396647665172742164" },
  { name: "Bronze Licence", min: 0, roleId: "1396647702766420061" },
];

// Channel and role IDs (FILL THESE IN for your server)
const RANK_CHANNEL_ID = "1397020407701307545"; // Channel for claim button (e.g. #🪪claim-licence)
const MOD_CHANNEL_ID = "1397236106881400872"; // Channel for mod commands (e.g. #🛠️・mod-tools)
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

// Helper: average calculation
function getAverage(driver) {
  const points = typeof driver.points === "number" ? driver.points : 0;
  const wins = typeof driver.wins === "number" ? driver.wins : 0;
  const kilometers =
    typeof driver.kilometers === "number" ? driver.kilometers : 0;
  return (points + wins + kilometers) / 3;
}

// Helper: determine rank
function getRank(driver) {
  const avg = getAverage(driver);
  return RANKS.find((rank) => avg >= rank.min) || null;
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

/* === COMMANDS: For moderators/admins/creators in mod-tools channel === */
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

  // Change track command
  if (msg.content.startsWith("!changetrack")) {
    const args = msg.content.split(" ");
    if (args.length < 2) {
      msg.reply("Usage: `!changetrack <track> [car]`");
      return;
    }
    const track = args[1];
    const car = args[2] || "tatuusfa1";
    const newSettings = { track, car };
    fs.writeFileSync(
      path.join(__dirname, SETTINGS_FILE),
      JSON.stringify(newSettings, null, 2)
    );
    msg.reply(
      `✅ Leaderboard settings updated!\n**Track:** \`${track}\`\n**Car:** \`${car}\``
    );
    console.log(
      `[MOD] Settings updated by ${msg.author.tag}: ${JSON.stringify(
        newSettings
      )}`
    );
    return;
  }

  // Manual assignranks command
  if (msg.content.startsWith("!assignranks")) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllRanks(guild);
    msg.reply("All linked members have now been ranked!");
    return;
  }
});

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
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);
