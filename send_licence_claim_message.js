require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const LICENCE_CHANNEL_ID = "1397020407701307545";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

async function sendLicenceClaimMessage() {
  try {
    const channel = await client.channels.fetch(LICENCE_CHANNEL_ID);

    if (!channel) {
      console.log("[ERROR] Licence claim channel not found!");
      return;
    }

    const button = new ButtonBuilder()
      .setCustomId("link_steam")
      .setLabel("Link Steam")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      content:
        "Do you want to link your Steam account to Discord? Click the button below.\n\nAfter linking, you will automatically receive a **licence** role based on your stats!",
      components: [row],
    });

    console.log(
      `[INFO] Licence claim message sent in #${channel.name} (${channel.id})`
    );
  } catch (err) {
    console.log("[ERROR] Error while sending claim message:", err);
  }
}

client.once("ready", async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  await sendLicenceClaimMessage();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
