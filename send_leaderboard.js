require("dotenv").config();

const ftp = require("basic-ftp");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "leaderboard_settings.json";
let SETTINGS = {
  track: "ks_nurburgring_layout_gp_a",
  car: "tatuusfa1",
  track_image_url:
    "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/nurburgring.png",
};
if (fs.existsSync(path.join(__dirname, SETTINGS_FILE))) {
  SETTINGS = JSON.parse(
    fs.readFileSync(path.join(__dirname, SETTINGS_FILE), "utf8")
  );
}
const TRACK = SETTINGS.track;
const CAR = SETTINGS.car;
const TRACK_IMAGE_URL = SETTINGS.track_image_url;

const {
  FTP_HOST = "",
  FTP_USER = "",
  FTP_PASS = "",
  DISCORD_WEBHOOK = "",
} = process.env;

const LEADERBOARD_FILE = "leaderboard.json";
const MESSAGE_ID_FILE = "discord_message_id.txt";
const TOP_N = 10;

function msToMinSec(ms) {
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

function truncateName(name, maxLen = 30) {
  return name.length <= maxLen ? name : name.slice(0, maxLen - 3) + "...";
}

async function ftpDownload(filename, localPath) {
  const client = new ftp.Client();
  await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
  await client.downloadTo(localPath, filename);
  client.close();
}

async function ftpUpload(localPath, remoteName) {
  const client = new ftp.Client();
  await client.access({ host: FTP_HOST, user: FTP_USER, password: FTP_PASS });
  await client.uploadFrom(localPath, remoteName);
  client.close();
}

async function getSavedMessageId() {
  try {
    const tmp = path.join(__dirname, "__mid.tmp");
    await ftpDownload(MESSAGE_ID_FILE, tmp);
    const id = fs.readFileSync(tmp, "utf8").trim();
    fs.unlinkSync(tmp);
    return id;
  } catch {
    return null;
  }
}

async function saveMessageId(id) {
  fs.writeFileSync(path.join(__dirname, MESSAGE_ID_FILE), id);
  await ftpUpload(path.join(__dirname, MESSAGE_ID_FILE), MESSAGE_ID_FILE);
}

async function fetchLeaderboard() {
  await ftpDownload(LEADERBOARD_FILE, path.join(__dirname, LEADERBOARD_FILE));
  const raw = fs.readFileSync(path.join(__dirname, LEADERBOARD_FILE), "utf8");
  return JSON.parse(raw);
}

function buildEmbed(data) {
  const lb = data[TRACK]?.[CAR] || [];
  lb.sort((a, b) => a.laptime - b.laptime);
  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

  let description =
    `**Track:** \`${TRACK}\`\n` +
    `**Car:** \`${CAR}\`\n\n` +
    `**Top ${TOP_N}:**\n`;

  lb.slice(0, TOP_N).forEach((entry, idx) => {
    const place = idx + 1;
    const medal = medals[place] || "";
    const name = truncateName(entry.name || "Unknown");
    const time = msToMinSec(entry.laptime || 0);
    description += `${place}. \`${time}\` — **${name}**${
      medal ? " " + medal : ""
    }\n`;
  });

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "🏆 AC Elite Assistant Leaderboard",
      url: "https://acstuff.ru/s/q:race/online/join?httpPort=18283&ip=157.90.3.32",
      iconURL:
        "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png",
    })
    .setTitle("AC Elite Server")
    .setURL(
      "https://acstuff.ru/s/q:race/online/join?httpPort=18283&ip=157.90.3.32"
    )
    .setColor(0xff0000)
    .setThumbnail(
      "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png"
    )
    .setImage(TRACK_IMAGE_URL)
    .setDescription(description)
    .setFooter({
      text: "Data by AC Elite Leaderboard",
      iconURL:
        "https://raw.githubusercontent.com/xstellaa10/ac-elite-leaderboard-bot/master/images/acelite.png",
    })
    .setTimestamp();

  return embed;
}

async function main() {
  const data = await fetchLeaderboard();
  const webhook = new WebhookClient({ url: DISCORD_WEBHOOK });
  const embed = buildEmbed(data);
  const savedId = await getSavedMessageId();

  if (savedId) {
    try {
      await webhook.editMessage(savedId, { embeds: [embed] });
      console.log(`✅ Edited message ${savedId}`);
      return;
    } catch (err) {
      if (err.code !== 10008) {
        console.error("Fout bij edit:", err);
        return;
      }
    }
  }

  const sent = await webhook.send({ embeds: [embed] });
  console.log(`✅ Posted new message ${sent.id}`);
  await saveMessageId(sent.id);
}

main().catch(console.error);
