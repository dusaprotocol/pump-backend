import { Token } from "@prisma/client";
import { getURL, nsfwPath } from "../config";
import logger from "../logger";

const websiteUrl = "https://pump-dusa.netlify.app/trade/";

export const sendDiscordAlert = async (token: Token) => {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) return;

  const tokenPageUrl = websiteUrl + token.address;
  const nsfwUrl = getURL("WS_API_URL1", `${nsfwPath}?address=${token.address}`);

  const params = {
    content: `[token page](${tokenPageUrl})\n[mark as nsfw](${nsfwUrl})`,
    embeds: [
      {
        title: `${token.name} (${token.symbol})`,
        description: token.description,
        image: {
          url: token.imageURI,
        },
      },
    ],
  };
  fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      if (res.ok) return;

      const json = await res.json();
      logger.error(json);
    })
    .catch(logger.error);
};
