import { getURL } from "../../common/config";
import logger from "../../common/logger";

const f = (url: string) => {
  fetch(url)
    .then((res) => logger.silly("done", res.ok))
    .catch(logger.error);
};

export const alertNewSwap = (txHash: string) => {
  const opts = "/add-swap?txHash=" + txHash;

  f(getURL("WS_API_URL1", opts));
  f(getURL("WS_API_URL2", opts));
};

export const alertNewToken = (address: string) => {
  const opts = "/add-token?address=" + address;

  f(getURL("WS_API_URL1", opts));
  f(getURL("WS_API_URL2", opts));
};
