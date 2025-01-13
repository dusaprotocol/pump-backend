import { EventDecoder, Fraction, IBaseContract } from "@dusalabs/sdk";
import { CORE, WMAS, deployerSC } from "../../common/contracts";
import { handlePrismaError, prisma } from "../../common/db";
import { alertNewSwap, alertNewToken } from "./socket";
import {
  NewFilledBlocksResponse,
  NewSlotExecutionOutputsResponse,
} from "../gen/ts/massa/api/v1/public";
import { SignedOperation } from "../gen/ts/massa/model/v1/operation";
import { getEventTimestamp } from "./utils";
import * as gRPC from "./grpc";
import { decodeSwapEvent, isSwapMethod, SwapMethod } from "./decoder";
import {
  adjustPrice,
  calculateSwapValue,
  getCallee,
  roundFraction,
  toToken,
} from "../../common/methods";
import { getReserves, getTokenValue } from "../../common/datastoreFetcher";
import { bytesToStr, IEvent } from "@massalabs/massa-web3";
import { getClosestTick } from "../../common/utils";
import { sendDiscordAlert } from "../../common/lib/discord";
import { createSwap, updateVolumeAndPrice } from "./db";
import { web3Client } from "../../common/client";
import * as constants from "../../common/config";
import logger from "../../common/logger";
import { migratePool } from "./migration";

export async function handleNewSlotExecutionOutputs(
  message: NewSlotExecutionOutputsResponse
) {
  const output = message.output?.executionOutput;
  if (!output) return;

  const { events, slot, blockId: block } = output;
  const period = Number(slot?.period) || 0;
  const thread = Number(slot?.thread) || 0;
  const blockId = block?.value || "";
  logger.silly({ period, thread, blockId });
  if (!events) return;

  events.forEach(async (event) => {
    try {
      if (!event.context) return;

      const eventData = bytesToStr(event.data);

      if (
        eventData.startsWith("Swap") &&
        event.context.callStack[0].startsWith("AS1")
      ) {
        logger.info({ event });
      } else return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      prisma.log
        .create({
          data: {
            data: Buffer.from(JSON.stringify(event)),
            message: Buffer.from(err.message),
          },
        })
        .catch(handlePrismaError);
    }
  });
}

export async function handleNewFilledBlocks(message: NewFilledBlocksResponse) {
  if (!message.filledBlock) return;

  const { header, operations } = message.filledBlock;
  const blockId = header?.secureHash;
  if (!blockId || !operations.length) return;

  const slot = header?.content?.slot;
  if (!slot) return;

  operations.forEach(
    (op, i) => op.operation && processSignedOperation(op.operation, i)
  );
}

export const processSignedOperation = async (
  signedOperation: SignedOperation,
  indexInSlot: number = 0
) => {
  const {
    secureHash: txHash,
    contentCreatorAddress: userAddress,
    content: operation,
  } = signedOperation;
  const opType = operation?.op?.type;
  if (opType?.oneofKind !== "callSc") return;

  const { targetAddress, targetFunction } = opType.callSc;
  const indexedSC = [...CORE];
  if (!indexedSC.includes(targetAddress) && !isSwapMethod(targetFunction))
    return;

  // wait 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const { isError, events } = await gRPC.fetchEvents(txHash);

  if (targetFunction === "deploy" && targetAddress === deployerSC) {
    if (isError) {
      await prisma.token
        .delete({ where: { address: txHash } })
        .catch(handlePrismaError);
      return;
    }

    const event = events.find((e) => e.data.startsWith("NEW_PAIR"));
    const swapEvent = events.find((e) => e.data.startsWith("Swap"));
    if (!event) return;

    const [token0, token1, pairAddress] = EventDecoder.extractParams(
      event.data
    );
    const tokenAddress = token0 === WMAS.address ? token1 : token0;
    const token = await prisma.token
      .update({ where: { address: txHash }, data: { address: tokenAddress } })
      .catch(handlePrismaError);
    if (!token) return;

    const initialAmountMAS = constants.virtualLiquidity;
    const initialAmountToken =
      constants.totalSupply + constants.virtualLiquidity;
    const price = adjustPrice(
      roundFraction(new Fraction(initialAmountMAS, initialAmountToken)),
      token.decimals,
      WMAS.decimals
    );
    const success = await prisma.analytics
      .create({
        data: {
          pool: {
            connectOrCreate: {
              create: { address: pairAddress, tokenAddress },
              where: { address: pairAddress },
            },
          },
          volume0: "0",
          volume1: "0",
          close: price,
          open: price,
          high: price,
          low: price,
          date: getClosestTick(),
          fees: 0,
          volume: 0,
        },
      })
      .then(() => true)
      .catch(handlePrismaError);
    if (!success) return;

    if (swapEvent)
      handleSwap(txHash, "buy", swapEvent, userAddress, indexInSlot);
    alertNewToken(tokenAddress);
    sendDiscordAlert(token);

    return;
  }

  if (isError) return;

  try {
    if (isSwapMethod(targetFunction)) {
      const swapEvent = events.find((e) => e.data.startsWith("Swap"));
      if (!swapEvent) return;

      // prettier-ignore
      await handleSwap(txHash, targetFunction, swapEvent, userAddress, indexInSlot);
    } else throw new Error(`Unknown ${targetFunction} on ${targetAddress}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    logger.error(err.message);
    prisma.log
      .create({
        data: {
          data: Buffer.from(JSON.stringify(events)),
          message: Buffer.from(err.message),
        },
      })
      .catch(handlePrismaError);
  }
};

const handleSwap = async (
  txHash: string,
  targetFunction: SwapMethod,
  swapEvent: IEvent,
  userAddress: string,
  indexInSlot: number = 0
) => {
  const timestamp = getEventTimestamp(swapEvent);
  const poolAddress = getCallee(swapEvent.context.call_stack);
  const tokenAddress = await new IBaseContract(poolAddress, web3Client)
    .extract(["token0"])
    .then((res) => {
      if (!res[0]) throw new Error("token not found");
      return bytesToStr(res[0]);
    });
  const token = toToken({
    address: tokenAddress,
    decimals: constants.tokenDecimals,
  });

  const swapForY = targetFunction === "sell";
  const tokenIn = swapForY ? toToken(token) : WMAS;
  const tokenX = token;
  const tokenY = WMAS;
  const { amount0In, amount1In, amount0Out, amount1Out } = decodeSwapEvent(
    swapEvent.data
  );
  const protocolFees = new Fraction(10n, 1000n);
  const amountInWithoutFees = new Fraction(swapForY ? amount0In : amount1In);
  const amountInWithFees = amountInWithoutFees.divide(
    new Fraction(1n).subtract(protocolFees)
  );
  const feesIn = amountInWithFees.subtract(amountInWithoutFees).quotient;
  const amountIn = amountInWithFees.quotient;
  const amountOut = swapForY ? amount1Out : amount0Out;
  const amountMas = swapForY ? amountOut : amountIn;
  const amountToken = swapForY ? amountIn : amountOut;
  const executionPrice = adjustPrice(
    roundFraction(new Fraction(amountMas, amountToken)),
    tokenX.decimals,
    tokenY.decimals
  );

  const reserves = await getReserves(poolAddress);

  // handle completed state
  if (reserves[0] === constants.lockedSupply + constants.virtualLiquidity) {
    const dusaPoolAddress = await migratePool(poolAddress, tokenAddress);
    await prisma.token
      .update({
        where: { address: token.address },
        data: { completed: true, completedAt: timestamp, dusaPoolAddress },
      })
      .then(() => logger.info("updated token: " + token.address))
      .catch(handlePrismaError);
  }

  const afterPrice = adjustPrice(
    roundFraction(new Fraction(reserves[1], reserves[0])),
    tokenX.decimals,
    tokenY.decimals
  );
  const valueIn = await getTokenValue(tokenIn, reserves);
  const { volume, fees } = calculateSwapValue({
    tokenIn,
    valueIn,
    amountIn,
    feesIn,
  });

  const success = await createSwap({
    timestamp,
    txHash,
    usdValue: volume,
    feesUsdValue: fees,
    poolAddress,
    // token0: tokenX,
    // token1: tokenY,
    tokenAddress: token.address,
    userAddress,
    indexInSlot,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    feesIn: feesIn.toString(),
    swapForY,
    executionPrice,
    afterPrice,
    afterReserve0: reserves[0].toString(),
    afterReserve1: reserves[1].toString(),
  });
  if (!success) return;

  updateVolumeAndPrice(
    poolAddress,
    amount0In,
    amount1In,
    volume,
    fees,
    afterPrice
  );
  alertNewSwap(txHash);
};
