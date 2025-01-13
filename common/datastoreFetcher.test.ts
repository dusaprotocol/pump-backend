import { describe, it, expect } from "vitest";
import * as DF from "./datastoreFetcher";
import * as M from "./methods";
import { WMAS } from "./contracts";
import { Token } from "@dusalabs/sdk";
import { CHAIN_ID, ONE_MAS, ONE_TOKEN, tokenDecimals } from "./config";

describe("getTokenValue", () => {
  it("returns proper WMAS price", async () => {
    const wmasValue = await DF.getWmasValue();
    expect(wmasValue).toBeGreaterThan(0.01);
    expect(wmasValue).toBeLessThan(1);

    const wmasValue2 = await DF.getTokenValue(WMAS);
    expect(wmasValue2).toBeGreaterThan(0.01);
    expect(wmasValue2).toBeLessThan(1);

    expect(wmasValue).toEqual(wmasValue2);
  });
  it("getPrice correctly calculates the price", () => {
    const token = new Token(CHAIN_ID, "0x", tokenDecimals);
    const reserves: [bigint, bigint] = [2n * ONE_TOKEN, ONE_MAS];
    const wmasValue = 2;
    const price = M.getPrice(token, reserves, wmasValue);
    expect(price).toBe(1);
    expect(price).toBeLessThan(3);
  });
  it("", async () => {
    const tokenAddress =
      "AS12Ao8JASjoTmtUzi9QDwcW6fPVEMbscaprB81SmRgYmoCZ7GXyW";
    const price = await DF.getTokenValue(
      M.toToken({ address: tokenAddress, decimals: tokenDecimals })
    );
    expect(price).toBeGreaterThan(0.00001);
    expect(price).toBeLessThan(1);
  });
});
