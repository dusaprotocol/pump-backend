import { ChainId, Token, USDC as _USDC } from "@dusalabs/sdk";
import { CHAIN_ID } from "./config";

type Contract = { [chainId in ChainId]: string };

const FACTORY_ADDRESS: Contract = {
  [ChainId.BUILDNET]: "AS1BU12yT6f9d95jbut1B1dUkpbwqrKuW3TErh9bFa1TgZ5TwFQv",
  [ChainId.MAINNET]: "",
};
const DEPLOYER_ADDRESS: Contract = {
  [ChainId.BUILDNET]: "AS1UQk1E1fEwBehodN1dw7ZzRc49b6ohgwQYwbcRjekTH2v1pNDC",
  [ChainId.MAINNET]: "",
};

export const dusaFactorySC =
  "AS12TEySQurYZwkfWbqRsnx2GmndPhW5ryfAKkGdSkBVgNm9fa1rA"; // LB_FACTORY_ADDRESS[CHAIN_ID]
export const dusaRouterSC =
  "AS12Kyqyfg6qRmHRdtmRS43GLymRSAn4FZHYqC4K75gG2DBbirGPp"; // LB_FACTORY_ADDRESS[CHAIN_ID]
export const dusaQuoterSC =
  "AS119JvNwg9Kd3jPmG13suF8vYLZLCjxWUvm3Mh2Ce2z8e4bW2ev"; // LB_QUOTER_ADDRESS[CHAIN_ID]
export const factorySC = FACTORY_ADDRESS[CHAIN_ID];
export const deployerSC = DEPLOYER_ADDRESS[CHAIN_ID];
export const CORE = [factorySC, deployerSC];

export const USDC = _USDC[CHAIN_ID];
export const WMAS = new Token(
  CHAIN_ID,
  "AS12LArwGjZcAQoaiBnL5Vs2SbaqXMj9P8y9oWjTmJzPbVoUeV9AJ",
  9,
  "WMAS"
); //  _WMAS[CHAIN_ID];

const USDC_WMAS_POOL_ADDRESS: Contract = {
  [ChainId.BUILDNET]: "AS112Wdy9pM4fvLNLHQXyf7uam9waMPdG5ekr4vxCyQHPkrMMPPY",
  [ChainId.MAINNET]: "AS12Q5NyCQUtEBTnnqqBwcGyYb18szbbKv5GArcdk9tm2HitTupHw",
};
export const wmasPoolSC = USDC_WMAS_POOL_ADDRESS[CHAIN_ID];
