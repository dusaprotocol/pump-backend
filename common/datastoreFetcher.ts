import { Args, bytesToStr, bytesToU256 } from "@massalabs/massa-web3";
import { web3Client } from "./client";
import { USDC, WMAS, factorySC, wmasPoolSC } from "./contracts";
import {
  Bin,
  IBaseContract,
  ILBPair,
  Token,
  WMAS as _WMAS,
} from "@dusalabs/sdk";
import { adjustPrice, getPrice } from "./methods";

export const fetchPairAddress = async (token: string): Promise<string> => {
  const key = `pairMapping::${token}:${WMAS.address}`;
  return new IBaseContract(factorySC, web3Client).extract([key]).then((res) => {
    if (!res[0]?.length) throw new Error("Pair not found");
    return bytesToStr(res[0]);
  });
};

export const getTokenValue = async (
  token: Token,
  reserves?: Reserves
): Promise<number> => {
  const wmasValue = await getWmasValue();
  if (token.address === WMAS.address) return wmasValue;

  let r = reserves;
  if (!r) {
    const pairAddress = await fetchPairAddress(token.address);
    if (!pairAddress) throw new Error("pair not found");
    r = await getReserves(pairAddress);
  }

  return getPrice(token, r, wmasValue);
};

/**
 * @dev hardcoded values for poolAddress & token order (should be safe)
 * @returns `WMAS` value in `USDC`
 */
export const getWmasValue = async () => {
  const activeId = await new IBaseContract(wmasPoolSC, web3Client)
    .extract(["PAIR_INFORMATION"])
    .then((res) => {
      if (!res[0]?.length) throw new Error("activeId not found");
      return new Args(res[0]).nextU32();
    });

  const token0 = WMAS;
  const token1 = USDC;
  return adjustPrice(
    Bin.getPriceFromId(activeId, 20),
    token0.decimals,
    token1.decimals
  );
};

export type Reserves = [bigint, bigint];
/**
 * Get pool reserves
 * @param address
 * @returns [token, WMAS] reserves
 */
export const getReserves = async (address: string): Promise<Reserves> => {
  return new IBaseContract(address, web3Client)
    .extract(["reserve0", "reserve1"])
    .then((r) => {
      if (r.length !== 2 || r.some((e) => !e))
        throw new Error("Reserves not found");
      return r.map((entry) => bytesToU256(entry!)) as Reserves;
    });
};
