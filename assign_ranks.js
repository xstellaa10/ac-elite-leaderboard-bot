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

/* =======================
   >>> CONFIGURATIE <<<
   ======================= */

// Vul hier je eigen Discord role-ID's en de score-drempels in.
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

// FTP settings uit je .env of Github secrets
const { FTP_HOST = "", FTP_USER = "", FTP_PASS = "" } = process.env;

// Filenamen
const LINKED_USERS_FILE = "linked_users.json";
const RANK_FILE = "rank.json";
const LOCAL_RANK_FILE = path.join(__dirname, RANK_FILE);

// Kanaalnaam waar je het koppelbericht wilt
const RANK_CHANNEL_NAME = "rank-test";

// ============ EINDE CONFIGURATIE ============

/* === FTP functie === */
async function ftpDownload(filename, localPath) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.downloadTo(localPath, filename);
    console.log(`[FTP] Gedownload: ${filename} -> ${localPath}`);
  } catch (err) {
    console.error("[FTP ERROR] Kan niet downloaden:", err);
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

/* === Helper: gemiddelde berekenen === */
function getAverage(rijder) {
  const points = typeof rijder.points === "number" ? rijder.points : 0;
  const wins = typeof rijder.wins === "number" ? rijder.wins : 0;
  const kilometers =
    typeof rijder.kilometers === "number" ? rijder.kilometers : 0;
  return (points + wins + kilometers) / 3;
}

/* === Helper: rank bepalen === */
function getRank(rijder) {
  const avg = getAverage(rijder);
  const found = RANKS.find((rank) => avg >= rank.min);
  return found ? found : null;
}

/* === Bij opstarten: koppelbutton automatisch plaatsen === */
client.once("ready", async () => {
  console.log(`✅ Bot online als ${client.user.tag}`);

  // Button auto in kanaal (indien nog niet aanwezig)
  try {
    const channel = client.channels.cache.find(
      (c) => c.name === RANK_CHANNEL_NAME && c.isTextBased()
    );
    if (!channel) {
      console.log("[ERROR] Koppel-kanaal niet gevonden!");
    } else {
      const messages = await channel.messages.fetch({ limit: 50 });
      const alreadySent = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.content.includes("Wil je je Steam-account koppelen")
      );

      if (!alreadySent) {
        const button = new ButtonBuilder()
          .setCustomId("link_steam")
          .setLabel("Koppel Steam")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({
          content:
            "Wil je je Steam-account koppelen aan je Discord? Klik op de button hieronder.\n\nNa koppelen krijg je automatisch een rankrol toegewezen op basis van je prestaties!",
          components: [row],
        });
        console.log(
          "[INFO] Koppelbericht automatisch verzonden in #" + RANK_CHANNEL_NAME
        );
      } else {
        console.log("[INFO] Koppelbericht bestaat al in #" + RANK_CHANNEL_NAME);
      }
    }
  } catch (err) {
    console.log("[ERROR] Fout bij auto-button plaatsen:", err);
  }

  // AUTO MODE VOOR GITHUB ACTION
  if (process.argv[2] === "auto") {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllRanks(guild);
    console.log("[AUTO] Alle gekoppelde leden automatisch gerankt.");
    process.exit(0);
  }
});

/* === Button click: DM sturen voor koppeling === */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "link_steam") return;

  await interaction.reply({
    content: "Check je DM! ✉️",
    ephemeral: true,
  });

  // DM sturen
  try {
    await interaction.user.send(
      "Hoi! Stuur hier je **Steam profiel link** of **Steam64 ID** (GUID) om te koppelen aan je Discord account.\n" +
        "Voorbeeld:\n`76561198000000000` of `https://steamcommunity.com/profiles/76561198000000000`"
    );
    console.log(
      `[INFO] DM gestuurd aan ${interaction.user.tag} voor koppeling`
    );
  } catch (err) {
    await interaction.followUp({
      content:
        "Kon je geen DM sturen! Zet DM's aan of neem contact op met een admin.",
      ephemeral: true,
    });
    console.log(`[ERROR] Kan DM niet sturen aan ${interaction.user.tag}:`, err);
  }
});

/* === DM verwerken: koppelen en rank geven === */
client.on("messageCreate", async (msg) => {
  // Alleen reageren op DM's die NIET van de bot zelf zijn
  if (msg.channel.type !== 1 || msg.author.bot) return;

  console.log(`[DEBUG] Ontvangen DM van ${msg.author.tag}: ${msg.content}`);

  // Steam GUID zoeken in bericht (17 cijfers)
  const match = msg.content.match(/(7656119\d{10,12})/);
  if (!match) {
    await msg.reply(
      "Ongeldige Steam64 ID. Stuur alleen je 17-cijferige Steam64 ID of volledige Steam profiel link."
    );
    console.log("[WARN] Geen geldige Steam GUID gevonden in DM");
    return;
  }
  const steamGuid = match[1];

  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  }

  // Koppeling al bekend?
  const alreadyLinked = Object.values(linked).includes(msg.author.id);
  if (
    alreadyLinked &&
    Object.entries(linked).find(
      ([guid, did]) => did === msg.author.id && guid === steamGuid
    )
  ) {
    await msg.reply(
      `Je Steam GUID \`${steamGuid}\` is al gekoppeld aan jouw Discord account. Zie je je rol niet? Typ \`!assignranks\` in de server.`
    );
    console.log("[INFO] Dubbele koppeling gedetecteerd, geen actie nodig");
    return;
  }

  // Nieuw of gewijzigde koppeling opslaan
  linked[steamGuid] = msg.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await msg.reply(
    `Gelukt! Je Steam GUID \`${steamGuid}\` is gekoppeld aan je Discord account. Je krijgt nu automatisch de juiste rol toegewezen!`
  );
  console.log(
    `[INFO] Koppeling opgeslagen: ${steamGuid} -> ${msg.author.tag} (${msg.author.id})`
  );

  // Direct rank geven
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignRankToMember(guild, steamGuid, msg.author.id);
});

/* === Rank functies === */

async function assignRankToMember(guild, steamGuid, discordId) {
  // Download de nieuwste rank.json voor elke actie
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Kan rank.json niet downloaden.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) {
    console.log("[ERROR] rank.json niet gevonden na downloaden!");
    return;
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));
  const rijder = data.find((r) => r.guid === steamGuid);
  if (!rijder) {
    console.log("[ERROR] Geen rijder gevonden voor GUID", steamGuid);
    return;
  }

  const rank = getRank(rijder);
  if (!rank) {
    console.log(`[ERROR] Geen rank gevonden voor ${rijder.name}`);
    return;
  }

  const member = await guild.members.fetch(discordId).catch((err) => {
    console.log("[ERROR] Member niet gevonden:", discordId, err);
    return null;
  });
  if (!member) {
    console.log("[ERROR] Member niet gevonden of geen toegang:", discordId);
    return;
  }

  // Alle bekende rankrollen verwijderen
  await member.roles.remove(RANKS.map((r) => r.roleId)).catch((err) => {
    console.log("[WARN] Kan oude rollen niet verwijderen:", err);
  });

  // Nieuwe rank geven
  await member.roles.add(rank.roleId).catch((err) => {
    console.log("[ERROR] Kan rol niet toevoegen:", err);
  });

  console.log(
    `[RESULT] Gegeven: ${rijder.name} (${discordId}) -> ${
      rank.name
    } (avg=${getAverage(rijder)})`
  );
}

async function assignAllRanks(guild) {
  try {
    await ftpDownload(RANK_FILE, LOCAL_RANK_FILE);
  } catch (err) {
    console.log("[ERROR] Kan rank.json niet downloaden.");
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) {
    console.log("[ERROR] Geen rank.json gevonden na downloaden!");
    return;
  }

  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE, "utf8"));

  for (const [steamGuid, discordId] of Object.entries(linked)) {
    const rijder = data.find((r) => r.guid === steamGuid);
    if (!rijder) {
      console.log("[WARN] Rijder niet gevonden voor GUID:", steamGuid);
      continue;
    }
    const rank = getRank(rijder);
    if (!rank) {
      console.log(`[ERROR] Geen rank gevonden voor ${rijder.name}`);
      continue;
    }
    const member = await guild.members.fetch(discordId).catch((err) => {
      console.log("[WARN] Member niet gevonden:", discordId, err);
      return null;
    });
    if (!member) {
      console.log("[WARN] Member niet gevonden of geen toegang:", discordId);
      continue;
    }
    await member.roles.remove(RANKS.map((r) => r.roleId)).catch((err) => {
      console.log("[WARN] Kan oude rollen niet verwijderen:", err);
    });
    await member.roles.add(rank.roleId).catch((err) => {
      console.log("[WARN] Kan rol niet toevoegen:", err);
    });
    console.log(
      `[RESULT] Gegeven: ${rijder.name} (${discordId}) -> ${
        rank.name
      } (avg=${getAverage(rijder)})`
    );
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);
