import { ChainId } from "@dusalabs/sdk";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" }); // loads env variables

function getEnvVariable(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key} in .env file`);

  return value;
}

export const getURL = (key: string, opts: string) =>
  getEnvVariable(key).replace(/\/$/, "") + "/api" + opts;

/* ENVIRONMENT VARIABLES */
export const CHAIN_URL = getEnvVariable("CHAIN_URL");
export const CHAIN_ID = Number(getEnvVariable("CHAIN_ID")) as ChainId;
export const grpcDefaultHost = getEnvVariable("GRPC_HOST");
export const grpcPort = Number(getEnvVariable("GRPC_PORT"));

/* CONSTANTS */
export const nsfwPath = "/mark-nsfw-QuAK0uB3h4pagn4NL3sC54pter";
export const tokenDecimals = 18;
export const ONE_MAS = 10n ** 9n;
export const ONE_TOKEN = 10n ** BigInt(tokenDecimals);
export const virtualLiquidity = 84_000n * ONE_MAS;
export const totalSupply = 1_000_000_000n * ONE_TOKEN;
export const lockedSupply = 200_000_000n * ONE_TOKEN;
