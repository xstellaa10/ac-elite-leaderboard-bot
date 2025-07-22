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

// Fill in your Discord role IDs and thresholds here.
const RANKS = [
  {
    name: "Platinum Licence",
    min: 700,
    roleId: "1397007839456657478",
  },
  {
    name: "Gold Licence",
    min: 500,
    roleId: "1396647621187076248",
  },
  {
    name: "Silver Licence",
    min: 200,
    roleId: "1396647665172742164",
  },
  {
    name: "Bronze Licence",
    min: 0,
    roleId: "1396647702766420061",
  },
];

// Set your channel ID here
const RANK_CHANNEL_ID = "1397020407701307545"; // <-- Replace with your own channel ID as a string!

// FTP settings from .env
const { FTP_HOST = "", FTP_USER = "", FTP_PASS = "" } = process.env;

// Filenames
const LINKED_USERS_FILE = "linked_users.json";
const RANK_FILE = "rank.json";
const LOCAL_RANK_FILE = path.join(__dirname, RANK_FILE);

/* ============ END CONFIGURATION ============ */

/* === FTP download function === */
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

/* === Discord Client === */
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

/* === Helper: Calculate average === */
function getAverage(driver) {
  const points = typeof driver.points === "number" ? driver.points : 0;
  const wins = typeof driver.wins === "number" ? driver.wins : 0;
  const kilometers =
    typeof driver.kilometers === "number" ? driver.kilometers : 0;
  return (points + wins + kilometers) / 3;
}

/* === Helper: Determine rank === */
function getRank(driver) {
  const avg = getAverage(driver);
  const found = RANKS.find((rank) => avg >= rank.min);
  return found ? found : null;
}

/* === On startup: Automatically send claim button in channel === */
client.once("ready", async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  // Auto-send button to the channel (if not already sent)
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
          `[INFO] Claim message automatically sent in #${channel.name} (${channel.id})`
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

  // AUTO MODE FOR GITHUB ACTION
  if (process.argv[2] === "auto") {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllRanks(guild);
    console.log("[AUTO] All linked members ranked automatically.");
    process.exit(0);
  }
});

/* === Button click: Send DM for linking === */
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

  console.log(`[DEBUG] DM received from ${msg.author.tag}: ${msg.content}`);

  // Look for Steam GUID (17 digits)
  const match = msg.content.match(/(7656119\d{10,12})/);
  if (!match) {
    await msg.reply(
      "Invalid Steam64 ID. Please only send your 17-digit Steam64 ID or full Steam profile link."
    );
    console.log("[WARN] No valid Steam GUID found in DM");
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
      `Your Steam GUID \`${steamGuid}\` is already linked to your Discord account. Don't see your role? Type \`!assignranks\` in the server.`
    );
    console.log("[INFO] Duplicate linking detected, no action needed");
    return;
  }

  // Save new or changed link
  linked[steamGuid] = msg.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await msg.reply(
    `Success! Your Steam GUID \`${steamGuid}\` is now linked to your Discord account. You will automatically get your correct role!`
  );
  console.log(
    `[INFO] Link saved: ${steamGuid} -> ${msg.author.tag} (${msg.author.id})`
  );

  // Immediately assign rank
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignRankToMember(guild, steamGuid, msg.author.id);
});

/* === Rank functions === */

async function assignRankToMember(guild, steamGuid, discordId) {
  // Download the latest rank.json for each action
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Could not download rank.json.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) {
    console.log("[ERROR] rank.json not found after download!");
    return;
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));
  const driver = data.find((r) => r.guid === steamGuid);
  if (!driver) {
    console.log("[ERROR] No driver found for GUID", steamGuid);
    return;
  }

  const rank = getRank(driver);
  if (!rank) {
    console.log(`[ERROR] No rank found for ${driver.name}`);
    return;
  }

  const member = await guild.members.fetch(discordId).catch((err) => {
    console.log("[ERROR] Member not found:", discordId, err);
    return null;
  });
  if (!member) {
    console.log("[ERROR] Member not found or inaccessible:", discordId);
    return;
  }

  // Remove all known rank roles
  await member.roles.remove(RANKS.map((r) => r.roleId)).catch((err) => {
    console.log("[WARN] Could not remove old roles:", err);
  });

  // Add new rank role
  await member.roles.add(rank.roleId).catch((err) => {
    console.log("[ERROR] Could not assign role:", err);
  });

  console.log(
    `[RESULT] Assigned: ${driver.name} (${discordId}) -> ${
      rank.name
    } (avg=${getAverage(driver)})`
  );
}

async function assignAllRanks(guild) {
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Could not download rank.json.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) {
    console.log("[ERROR] rank.json not found after download!");
    return;
  }

  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));

  for (const [steamGuid, discordId] of Object.entries(linked)) {
    const driver = data.find((r) => r.guid === steamGuid);
    if (!driver) {
      console.log("[WARN] Driver not found for GUID:", steamGuid);
      continue;
    }
    const rank = getRank(driver);
    if (!rank) {
      console.log(`[ERROR] No rank found for ${driver.name}`);
      continue;
    }
    const member = await guild.members.fetch(discordId).catch((err) => {
      console.log("[WARN] Member not found:", discordId, err);
      return null;
    });
    if (!member) {
      console.log("[WARN] Member not found or inaccessible:", discordId);
      continue;
    }
    await member.roles.remove(RANKS.map((r) => r.roleId)).catch((err) => {
      console.log("[WARN] Could not remove old roles:", err);
    });
    await member.roles.add(rank.roleId).catch((err) => {
      console.log("[WARN] Could not assign role:", err);
    });
    console.log(
      `[RESULT] Assigned: ${driver.name} (${discordId}) -> ${
        rank.name
      } (avg=${getAverage(driver)})`
    );
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);
