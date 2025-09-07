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
const {
  FTP_HOST = "",
  FTP_USER = "",
  FTP_PASS = "",
  DISABLE_RANKS = "false",
} = process.env;

// Helper: zijn ranks tijdelijk uitgeschakeld?
function ranksDisabled() {
  return String(DISABLE_RANKS).toLowerCase() === "true";
}

// Lokale/remote bestandsnamen
const LINKED_USERS_FILE = "linked_users.json";

// -- REMOTE (op de FTP) --
const REMOTE_RANK_FILE = "kissmyrank/rank.json";
const REMOTE_LEADERBOARD_FILE = "kissmyrank/leaderboard.json";

// -- LOKAAL (altijd alleen de bestandsnaam, met basename voor future-proof) --
const LOCAL_RANK_FILE = path.join(__dirname, path.basename(REMOTE_RANK_FILE));
const SETTINGS_FILE = "leaderboard_settings.json";
const LOCAL_LEADERBOARD_FILE = path.join(
  __dirname,
  path.basename(REMOTE_LEADERBOARD_FILE)
);

// Bericht-ID bestand blijft in de root van de FTP zoals voorheen
const MESSAGE_ID_FILE = "discord_message_id.txt";

const DEFAULT_LEADERBOARD_IMAGE =
  "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png";

/* ===================== END CONFIGURATION ===================== */

// FTP utility functions
async function ftpDownload(filename, localPath) {
  const client = new ftp.Client();
  try {
    await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
    await client.downloadTo(localPath, filename);
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
  } catch (err) {
    console.error("[FTP ERROR] Upload failed:", err);
  } finally {
    client.close();
  }
}

// Discord client setup
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

// Score calculation
function calculateScore(d) {
  const km = Math.max(1, d.kilometers ?? 0); // Prevent division by zero
  const winRate = (d.wins ?? 0) / (km / 1000);
  const podiumRate = (d.podiums ?? 0) / (km / 1000);
  const poleRate = (d.poles ?? 0) / (km / 1000);
  const flapRate = (d.flaps ?? 0) / (km / 1000);
  const enduranceBonus = Math.log10(km); // Small reward for distance

  return (
    winRate * 30 +
    podiumRate * 20 +
    poleRate * 15 +
    flapRate * 12 +
    enduranceBonus * 10 +
    (d.points ?? 0) * 0.05 -
    (d.infr ?? 0) * 1.5 -
    (d.crashes ?? 0) * 2.0 -
    (d.infr_per_100km ?? 0) * 25 -
    (d.cr_per_100km ?? 0) * 30
  );
}

function getLicence(d) {
  const score = calculateScore(d);
  return LICENCES.find((l) => score >= l.min) || null;
}

// On ready: placement & auto-run
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
      const btn = new ButtonBuilder()
        .setCustomId("link_steam")
        .setLabel("Link Steam")
        .setStyle(ButtonStyle.Primary);
      await ch.send({
        content: "Link your Steam account:",
        components: [new ActionRowBuilder().addComponents(btn)],
      });
    }
  } catch {}

  // Auto mode for cron
  if (process.argv[2] === "auto") {
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(`🚀 Auto run started at ${new Date().toLocaleString()}`);
    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    if (ranksDisabled()) {
      await log.send("⏸️ Auto-licence assignment skipped.");
    } else {
      await assignAllLicences(guild);
      await log.send("✅ Auto-assignment of licences completed");
    }

    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    await postLeaderboard(
      settings.track,
      settings.car,
      DEFAULT_LEADERBOARD_IMAGE
    );
    await log.send(
      `✅ Auto leaderboard updated for ${settings.track}/${settings.car}`
    );
    process.exit(0);
  }
});

// Interaction: claim button
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton() || i.customId !== "link_steam") return;
  await i.reply({ content: "Check your DM!", ephemeral: true });
  try {
    await i.user.send(
      `**Welcome to the KMR Steam Account Linking!**

To claim your licence and participate on our servers, please link your Steam account to your Discord account.

**How to do this:**
1. Open your Steam profile in your web browser (for example: \`https://steamcommunity.com/id/yourname\`).
2. Copy your Steam **profile link** OR your **Steam64 ID** (a long number starting with 7656119...).
   - To find your Steam64 ID, you can use a site like https://steamid.io or https://steamidfinder.com — just paste your profile link and copy the number listed as "SteamID64".
3. Send your Steam64 ID or profile link here in this chat.  
   _(Example: \`https://steamcommunity.com/profiles/76561198000000000\` or \`76561198000000000\`)_  
4. Once linked, you will be automatically assigned the correct licence role for your stats!

**⚠️ Please note:**  
- Each Steam account can only be linked to one Discord account.
- If you have already linked a Steam ID and need to change it, contact a moderator.

If you need help, just ask here or tag a mod in the server.`
    );
  } catch {}
});

// DM linking flow
client.on("messageCreate", async (m) => {
  if (m.channel.type !== 1 || m.author.bot) return;
  const match = m.content.match(/(7656119\d{10,12})/);
  if (!match) return m.reply("Invalid Steam64 ID.");
  const guid = match[1];

  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE))
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE));

  if (linked[guid]) {
    // Steam ID is already linked
    if (linked[guid] === m.author.id) {
      await m.reply(
        `✅ This Steam64 ID is already linked to your Discord account!\n\nIf you want to update or change your linked Steam account, please contact a moderator.`
      );
    } else {
      await m.reply(
        `❌ This Steam64 ID is already linked to another Discord user.\n\nIf you believe this is a mistake, or if someone else linked your Steam account, please contact a moderator for help.`
      );
    }
    return;
  }

  // Steam ID nog niet gelinkt, nu koppelen
  linked[guid] = m.author.id;
  fs.writeFileSync(LINKED_USERS_FILE, JSON.stringify(linked, null, 2));
  await m.reply(`✅ Gelinkt aan jouw account! (${guid})`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await assignLicenceToMember(guild, guid, m.author.id);
});

// Mod commands
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || msg.channel.id !== MOD_CHANNEL_ID) return;
  if (!MOD_ROLE_IDS.some((r) => msg.member.roles.cache.has(r))) {
    const r = await msg.reply("You don't have permission.");
    setTimeout(() => {
      r.delete().catch();
      msg.delete().catch();
    }, 8000);
    return;
  }

  // !achelp - DM moderator help commands
  if (msg.content.trim().toLowerCase() === "!achelp") {
    try {
      await msg.author.send(
        `**AC Elite Assistant Help**

Here are all the moderator commands you can use in #🛠️・mod-tools:

\`!changetrack [track] <car>\`
— Change the track and car for the leaderboard. Example: \`!changetrack spa ferrari488\`. (If you only provide the car, it defaults the track to "tatuusfa1".)
- **Tip:** You can find the correct full track names on the KMR Panel → Tracks: http://157.90.3.32:5283/tracks  
  Click on a track, then copy the track name from the end of the URL.  
  For example, if the URL is \`http://157.90.3.32:5283/track/ks_nurburgring_layout_gp_a\`, you should use \`ks_nurburgring_layout_gp_a\` as the track name in the command.

\`!assignlicences\`
— Manually assign licence roles to all currently linked Discord users based on the latest stats.

\`!updateleaderboard\`
— Post or update the leaderboard embed based on the current settings.

\`!achelp\`
— Get this list of commands sent to your DM!

*Notes:*
- Only users with a moderator role can use these commands.
- Use these commands only in the #🛠️・mod-tools channel.
- If you need help or something is broken, ask the bot owner.
`
      );
      const r = await msg.reply(
        "📬 I've sent you a DM with all available moderator commands!"
      );
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
    } catch (err) {
      const r = await msg.reply(
        "❌ I couldn't DM you. Please check your DM privacy settings."
      );
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
    }
    return;
  }

  // !changetrack [track] <car>
  if (msg.content.startsWith("!changetrack")) {
    const args = msg.content.split(/ +/).slice(1);
    let track, car;
    if (args.length === 1) {
      track = "tatuusfa1";
      car = args[0];
    } else if (args.length >= 2) {
      track = args[0];
      car = args[1];
    } else {
      const r = await msg.reply("Usage: !changetrack [track] <car>");
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
      return;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ track, car }, null, 2));
    const r = await msg.reply(`Settings updated: ${track}/${car}`);
    setTimeout(() => {
      r.delete().catch();
      msg.delete().catch();
    }, 8000);
    return;
  }

  // !assignlicences
  if (msg.content.startsWith("!assignlicences")) {
    if (ranksDisabled()) {
      const r = await msg.reply("⏸️ Ranks are temporary disabled.");
      setTimeout(() => {
        r.delete().catch();
        msg.delete().catch();
      }, 8000);
      return;
    }
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(
      `🛠️ Manual assignLicences at ${new Date().toLocaleString()}`
    );
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await assignAllLicences(guild);
    await log.send("✅ Manual assignLicences completed");
    const r = await msg.reply("All linked members licenced!");
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
      `🛠️ Manual leaderboard update at ${new Date().toLocaleString()}`
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
    try {
      await postLeaderboard(
        settings.track,
        settings.car,
        DEFAULT_LEADERBOARD_IMAGE
      );
      await log.send(
        `✅ Manual leaderboard updated for ${settings.track}/${settings.car}`
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
});

// Assign a single member with breakdown
async function assignLicenceToMember(guild, guid, did) {
  if (ranksDisabled()) {
    // Log netjes dat we hebben geskipped
    try {
      const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
      const user = await guild.members.fetch(did).catch(() => null);
      await log.send(
        `⏸️ Skipped assigning licence for ${
          user ? user.user.tag : did
        } (Steam64 ${guid}) because ranks are temporary disabled.`
      );
    } catch {}
    return;
  }
  try {
    await ftpDownload(REMOTE_RANK_FILE, LOCAL_RANK_FILE);
  } catch {
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) return;
  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE));
  const driver = data.find((d) => d.guid === guid);
  if (!driver) return;
  const lic = getLicence(driver);
  if (!lic) return;
  const score = calculateScore(driver);
  const breakdown = [
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
  ].join(", ");
  const member = await guild.members.fetch(did).catch(() => null);
  if (!member) return;
  await member.roles.remove(LICENCES.map((l) => l.roleId)).catch(() => {});
  await member.roles.add(lic.roleId).catch(() => {});
  const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
  await log.send(
    `Assigned **${lic.name}** to ${member.user.tag} (score: ${score.toFixed(
      2
    )}). Breakdown: ${breakdown}`
  );
}

// Assign all linked
async function assignAllLicences(guild) {
  if (ranksDisabled()) return;
  try {
    await ftpDownload(REMOTE_RANK_FILE, LOCAL_RANK_FILE);
  } catch {
    return;
  }
  if (!fs.existsSync(LOCAL_RANK_FILE)) return;

  let linked = {};
  if (fs.existsSync(LINKED_USERS_FILE)) {
    linked = JSON.parse(fs.readFileSync(LINKED_USERS_FILE));
  }

  const data = JSON.parse(fs.readFileSync(LOCAL_RANK_FILE));
  for (const [guid, did] of Object.entries(linked)) {
    const driver = data.find((d) => d.guid === guid);
    if (!driver) continue;
    const lic = getLicence(driver);
    if (!lic) continue;
    const member = await guild.members.fetch(did).catch(() => null);
    if (!member) continue;
    const score = calculateScore(driver);
    await member.roles.remove(LICENCES.map((l) => l.roleId)).catch(() => {});
    await member.roles.add(lic.roleId).catch(() => {});
    const breakdown = [
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
    ].join(", ");
    const log = await client.channels.fetch(MOD_TOOLS_LOGS_CHANNEL_ID);
    await log.send(
      `Auto-assigned **${lic.name}** to ${
        member.user.tag
      } (score: ${score.toFixed(2)}). Breakdown: ${breakdown}`
    );
  }
}

// Leaderboard post (met auto-swap detect)
async function postLeaderboard(track, car, imageUrl) {
  // Download en inlezen (REMOTE → LOCAL)
  await ftpDownload(REMOTE_LEADERBOARD_FILE, LOCAL_LEADERBOARD_FILE);
  const data = JSON.parse(fs.readFileSync(LOCAL_LEADERBOARD_FILE));

  // Detect swapped settings.json
  if (!data[track] && data[car] && data[car][track]) {
    console.warn(
      `[Leaderboard] Detected swapped track/car in settings. Swapping automatically.`
    );
    [track, car] = [car, track];
  }

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
    .setColor(0x6495ed)
    .setThumbnail(DEFAULT_LEADERBOARD_IMAGE)
    .setFooter({
      text: "Data by AC Elite Assistant",
      iconURL: DEFAULT_LEADERBOARD_IMAGE,
    })
    .setTimestamp();

  const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });
  let id = null;
  try {
    const tmp = path.join(__dirname, "__mid.tmp");
    await ftpDownload(MESSAGE_ID_FILE, tmp); // uit FTP-root
    id = fs.readFileSync(tmp, "utf8").trim();
    fs.unlinkSync(tmp);
  } catch {}
  if (id) {
    try {
      await webhook.editMessage(id, { embeds: [embed] });
      return;
    } catch (err) {
      if (err.code !== 10008) throw err;
    }
  }
  const sent = await webhook.send({ embeds: [embed] });
  fs.writeFileSync(path.join(__dirname, MESSAGE_ID_FILE), sent.id);
  await ftpUpload(path.join(__dirname, MESSAGE_ID_FILE), MESSAGE_ID_FILE);
}

client.login(process.env.DISCORD_BOT_TOKEN);
