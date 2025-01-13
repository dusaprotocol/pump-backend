import { Prisma } from "@prisma/client";
import { handlePrismaError, prisma } from "../../common/db";
import logger from "../../common/logger";
import { getClosestTick } from "../../common/utils";

const cocUser = (address: string) => ({
  connectOrCreate: { where: { address }, create: { address } },
});

const coPool = (
  address: string,
  tokenAddress: string
): Prisma.PoolCreateNestedOneWithoutSwapTxsInput => ({
  connectOrCreate: {
    where: { address },
    create: {
      address,
      token: { connect: { address: tokenAddress } },
    },
  },
});

export const createSwap = async (
  payload: Prisma.SwapUncheckedCreateInput & { tokenAddress: string }
): Promise<boolean> => {
  // prettier-ignore
  const { poolAddress, userAddress, amountIn, amountOut, feesIn, swapForY, timestamp, txHash, usdValue, feesUsdValue, indexInSlot, tokenAddress, executionPrice, afterPrice, afterReserve0, afterReserve1 } = payload;
  return prisma.swap
    .create({
      data: {
        pool: coPool(poolAddress, tokenAddress),
        user: cocUser(userAddress),
        amountIn,
        amountOut,
        executionPrice,
        afterPrice,
        afterReserve0,
        afterReserve1,
        feesIn,
        timestamp,
        txHash,
        usdValue,
        feesUsdValue,
        indexInSlot,
        swapForY,
      },
    })
    .then(() => true)
    .catch((err) => {
      handlePrismaError(err);
      return false;
    });
};

export const updateVolumeAndPrice = async (
  poolAddress: string,
  volume0: bigint,
  volume1: bigint,
  volume: number,
  fees: number,
  price: number
) => {
  const date = getClosestTick();
  const curr = await prisma.analytics.findUnique({
    where: { poolAddress_date: { poolAddress, date } },
  });
  if (!curr) {
    const lastTick = await prisma.analytics.findFirst({
      where: { poolAddress },
      orderBy: { date: "desc" },
    });
    const open = lastTick ? lastTick.close : price;
    const low = Math.min(open, price);
    const high = Math.max(open, price);

    await prisma.analytics
      .create({
        data: {
          poolAddress,
          date,
          volume,
          fees,
          volume0: volume0.toString(),
          volume1: volume1.toString(),
          open,
          close: price,
          high,
          low,
        },
      })
      .catch(handlePrismaError);

    return;
  }

  const data: Prisma.AnalyticsUpdateInput = {
    close: price,
  };
  if (price > curr.high) data.high = price;
  if (price < curr.low) data.low = price;

  return prisma.analytics
    .update({
      where: { poolAddress_date: { poolAddress, date } },
      data: {
        volume: { increment: volume },
        fees: { increment: fees },
        ...data,
      },
    })
    .catch(handlePrismaError);
};
