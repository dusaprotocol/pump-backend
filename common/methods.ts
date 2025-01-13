import { CHAIN_ID, tokenDecimals } from "./config";
import { Fraction, parseUnits, Token, TokenAmount } from "@dusalabs/sdk";
import { Token as PrismaToken } from "@prisma/client";
import { WMAS } from "./contracts";
import { Reserves } from "./datastoreFetcher";

export const getCallee = (callStack: string[]): string => {
  return callStack[callStack.length - 1];
};

export const adjustPrice = (
  price: number,
  decimals0: number,
  decimals1: number
): number => price * 10 ** (decimals0 - decimals1);

export const swapFees = 990n; // base 1000, 1% fee

/**
 * Calculate the USD price of a token, based on pool reserves and wmas price
 * @param token
 * @param reserves
 * @param wmasValue
 * @returns
 */
export const getPrice = (
  token: Token,
  reserves: Reserves,
  wmasValue: number
) => {
  const reserveIn = reserves[1];
  const reserveOut = reserves[0];
  const priceInMas = new Fraction(
    reserveIn * BigInt(10 ** (token.decimals - WMAS.decimals)),
    reserveOut
  ).toFixed(tokenDecimals);
  const rounded = Number(
    new TokenAmount(WMAS, parseUnits(priceInMas, WMAS.decimals)).toSignificant(
      6
    )
  );
  return rounded * wmasValue;
};

export const calculateSwapValue = (params: {
  tokenIn: Token;
  valueIn: number;
  amountIn: bigint;
  feesIn: bigint;
}) => {
  const { tokenIn, valueIn, amountIn, feesIn } = params;
  const [volume, fees] = [amountIn, feesIn].map((v) =>
    roundFraction(new TokenAmount(tokenIn, v).multiply(toFraction(valueIn)))
  );
  return { volume, fees };
};

export const toFraction = (val: number): Fraction => {
  if (val === 0) return new Fraction(0n, 1n);
  const value = BigInt(Math.round(val * 1e18));
  return new Fraction(value, BigInt(1e18));
};

export const round = (value: number, precision = 2) =>
  Number(value.toFixed(precision));

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
// prettier-ignore
type PartialToken = PartialBy<
  PrismaToken, | "name" | "symbol" | "description" | "telegram" | "twitter" | "website" | "createdBy" | "imageURI" | "createdAt" | "dusaPoolAddress" | "nsfw" | "completed" | "completedAt"
>;
export const toToken = (token: PartialToken, chainId = CHAIN_ID) =>
  new Token(chainId, token.address, token.decimals, token.symbol, token.name);

export const roundFraction = (amount: Fraction, precision = 6) =>
  Number(amount.toSignificant(precision));

export const calculateUSDValue = (
  amount0: TokenAmount,
  token0Value: number,
  amount1: TokenAmount,
  token1Value: number
): number =>
  roundFraction(
    amount0
      .multiply(toFraction(token0Value))
      .add(amount1.multiply(toFraction(token1Value)))
  );
