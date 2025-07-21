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

// SETTINGS
const GOLD_ROLE_ID = "1396647621187076248";
const SILVER_ROLE_ID = "1396647665172742164";
const BRONZE_ROLE_ID = "1396647702766420061";
const LINKED_USERS_FILE = "linked_users.json";
const RANK_FILE = "rank.json";

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

client.once("ready", () => {
  console.log(`Bot online als ${client.user.tag}`);
});

// 1. Stuur koppelbericht met button
client.on("messageCreate", async (msg) => {
  if (msg.content === "!koppelbericht" && msg.channel.name === "rank-test") {
    const button = new ButtonBuilder()
      .setCustomId("link_steam")
      .setLabel("Koppel Steam")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await msg.channel.send({
      content:
        "Wil je je Steam-account koppelen aan je Discord? Klik op de button hieronder.\n\nNa koppelen krijg je automatisch een rankrol toegewezen op basis van je punten!",
      components: [row],
    });
  }

  // Commando om handmatig alle gekoppelden hun rankrol te geven
  if (msg.content === "!assignranks") {
    await assignAllRanks(msg.guild);
    msg.reply("Alle gekoppelde leden zijn nu gerankt! ✅");
  }
});

// 2. Button click: DM sturen om Steam GUID te koppelen
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
  } catch {
    await interaction.followUp({
      content:
        "Kon je geen DM sturen! Zet DM's aan of neem contact op met een admin.",
      ephemeral: true,
    });
  }
});

// 3. DM verwerken en koppeling opslaan
client.on("messageCreate", async (msg) => {
  if (msg.channel.type !== 1) return; // Alleen DM's

  // Steam GUID zoeken in bericht (17 cijfers)
  const match = msg.content.match(/(7656119\d{10,12})/);
  if (!match) {
    await msg.reply(
      "Ongeldige Steam64 ID. Stuur alleen je 17-cijferige Steam64 ID of volledige Steam profiel link."
    );
    return;
  }
  const steamGuid = match[1];

  // Sla koppeling op
  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  }

  // Spam voorkomen: alleen nieuwe koppeling opslaan en rol geven
  if (linked[steamGuid] && linked[steamGuid] === msg.author.id) {
    await msg.reply(
      `Je Steam GUID \`${steamGuid}\` is al gekoppeld aan jouw Discord account. Zie je je rol niet? Typ \`!assignranks\` in de server.`
    );
    return;
  }

  linked[steamGuid] = msg.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));

  await msg.reply(
    `Gelukt! Je Steam GUID \`${steamGuid}\` is gekoppeld aan je Discord account. Je krijgt nu automatisch de juiste rol toegewezen!`
  );

  // Rol direct toekennen
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignRankToMember(guild, steamGuid, msg.author.id);
});

// 4. Hulpfuncties

function getRank(points) {
  if (points >= 1000) return GOLD_ROLE_ID;
  if (points >= 300) return SILVER_ROLE_ID;
  return BRONZE_ROLE_ID;
}

async function assignRankToMember(guild, steamGuid, discordId) {
  if (!fs.existsSync(RANK_FILE)) return;
  const data = JSON.parse(fs.readFileSync(RANK_FILE, "utf8"));
  const rijder = data.find((r) => r.guid === steamGuid);
  if (!rijder) return;

  const rankRoleId = getRank(rijder.points);

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return;

  // Oude rollen eraf
  await member.roles
    .remove([GOLD_ROLE_ID, SILVER_ROLE_ID, BRONZE_ROLE_ID])
    .catch(() => {});
  // Nieuwe rol toevoegen
  await member.roles.add(rankRoleId).catch(() => {});
  console.log(`Gegeven: ${rijder.name} (${discordId}) -> ${rankRoleId}`);
}

async function assignAllRanks(guild) {
  if (!fs.existsSync(LINKED_USERS_FILE)) return;
  if (!fs.existsSync(RANK_FILE)) return;

  const linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(RANK_FILE, "utf8"));

  for (const [steamGuid, discordId] of Object.entries(linked)) {
    const rijder = data.find((r) => r.guid === steamGuid);
    if (!rijder) continue;

    const rankRoleId = getRank(rijder.points);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;

    await member.roles
      .remove([GOLD_ROLE_ID, SILVER_ROLE_ID, BRONZE_ROLE_ID])
      .catch(() => {});
    await member.roles.add(rankRoleId).catch(() => {});
    console.log(`Gegeven: ${rijder.name} (${discordId}) -> ${rankRoleId}`);
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);
