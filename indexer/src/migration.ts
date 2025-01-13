import {
  ChainId,
  IBaseContract,
  IERC20,
  IFactory,
  ILBPair,
  IRouter,
  LiquidityDistribution,
  PairV2,
  parseEther,
  Percent,
  TokenAmount,
} from "@dusalabs/sdk";
import {
  deployerSC,
  dusaFactorySC,
  dusaRouterSC,
  factorySC,
  WMAS,
} from "../../common/contracts";
import { CHAIN_ID, lockedSupply } from "../../common/config";
import { toToken } from "../../common/methods";
import {
  WalletClient,
  Args,
  EOperationStatus,
  MassaUnits,
  CHAIN_ID as MASSA_CHAIN_ID,
  ClientFactory,
} from "@massalabs/massa-web3";
import { providers } from "../../common/client";
import logger from "../../common/logger";

const migrateFee = 7n; // base 100, 7%

export const migratePool = async (
  pairPump: string,
  tokenAddress: string
): Promise<string> => {
  // Init constants
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing PRIVATE_KEY in .env file");
  const account = await WalletClient.getAccountFromSecretKey(privateKey);
  if (!account.address) throw new Error("Missing address in account");

  // doesnt work
  // await client.wallet().addAccountsToWallet([account]);

  const massaChainId =
    CHAIN_ID === ChainId.BUILDNET
      ? MASSA_CHAIN_ID.BuildNet
      : MASSA_CHAIN_ID.MainNet;
  const client = await ClientFactory.createCustomClient(
    providers,
    massaChainId,
    true,
    account
  );

  const pumpDeployer = deployerSC;
  const router = new IRouter(dusaRouterSC, client);

  const token = toToken({ address: tokenAddress, decimals: 18 });
  // const txIdMigrate = await new IBaseContract(pumpDeployer, client).call({
  //   targetFunction: "migratePool",
  //   parameter: new Args().addString(pairPump),
  // });
  // console.log("txIdMigrate: " + txIdMigrate);

  const wmas = new IERC20(WMAS.address, client);
  const balanceWmas = await wmas.balanceOf(account.address);
  const fee = (balanceWmas * migrateFee) / 100n;
  const balanceWmasWithoutFee = balanceWmas - fee;
  const wmasAmount = new TokenAmount(WMAS, balanceWmasWithoutFee);
  const tokenAmount = new TokenAmount(token, lockedSupply);

  // set amount slippage tolerance
  const allowedAmountSlippage = 50; // in bips, 0.5% in this case
  const amountSlippage = new Percent(BigInt(allowedAmountSlippage), 10_000n);

  // set price slippage tolerance
  const allowedPriceSlippage = 0; // in bips, 0% in this case
  const priceSlippage = new Percent(BigInt(allowedPriceSlippage), 10_000n);

  // set deadline for the transaction
  const currentTimeInMs = new Date().getTime();
  const deadline = currentTimeInMs + 3_600_000;

  const pair = new PairV2(token, WMAS);
  const binStep = 100;
  const activeId = 8385906; // 1 token = 0.002107 MAS

  // await transaction confirmation before proceeding
  // const statusMigrate = await client
  //   .smartContracts()
  //   .awaitRequiredOperationStatus(txIdMigrate, EOperationStatus.FINAL_SUCCESS);
  // if (statusMigrate !== EOperationStatus.FINAL_SUCCESS)
  //   throw new Error("Something went wrong");

  // create pair
  const factory = new IFactory(dusaFactorySC, client);
  const pairInfo = await factory
    .getLBPairInformation(tokenAddress, WMAS.address, binStep)
    .catch((e) => {
      console.error(e);
      return null;
    });
  const pairExists = !!pairInfo?.LBPair;

  let LBPair = pairExists ? pairInfo.LBPair : "";
  if (!pairExists) {
    const txIdPair = await factory.call(
      {
        targetFunction: "createLBPair",
        coins: 50n * MassaUnits.oneMassa,
        parameter: new Args()
          .addString(tokenAddress)
          .addString(WMAS.address)
          .addU32(activeId)
          .addU32(binStep),
      },
      false
    );
    console.log("txIdPair: " + txIdPair);

    // await transaction confirmation before proceeding
    const statusPair = await client
      .smartContracts()
      .awaitRequiredOperationStatus(txIdPair, EOperationStatus.FINAL_SUCCESS);
    if (statusPair !== EOperationStatus.FINAL_SUCCESS)
      throw new Error("Something went wrong");

    // wait 5 seconds for the pair to be created
    await new Promise((resolve) => setTimeout(resolve, 5000));

    LBPair = await pair
      .fetchLBPair(binStep, client, CHAIN_ID)
      .then((pair) => pair.LBPair);
  }
  console.log("LBPair: " + LBPair);

  // increase allowance for the router
  const approveTxId1 = await new IERC20(token.address, client).approve(
    router.address,
    tokenAmount.raw
  );
  console.log("approveTxId1: " + approveTxId1);
  const approveTxId2 = await wmas.approve(router.address, wmasAmount.raw);
  console.log("approveTxId2: " + approveTxId2);

  const amountWmasPerBatch = (70n * wmasAmount.raw) / 215n;
  const amountTokenPerBatch = (70n * tokenAmount.raw) / 485n;

  const wmasAmount1 = new TokenAmount(WMAS, 0n);
  const tokenAmount1 = new TokenAmount(token, amountTokenPerBatch);

  const amountWmasBatchActif = (5n * wmasAmount.raw) / 215n;
  const amountTokenBatchActif = (65n * tokenAmount.raw) / 485n;
  const wmasAmount2 = new TokenAmount(WMAS, amountWmasBatchActif);
  const tokenAmount2 = new TokenAmount(token, amountTokenBatchActif);

  const wmasAmount3 = new TokenAmount(WMAS, amountWmasPerBatch);
  const tokenAmount3 = new TokenAmount(token, 0n);

  let addLiquidityInput = await pair.addLiquidityParameters(
    LBPair,
    binStep,
    tokenAmount1,
    wmasAmount1,
    amountSlippage,
    priceSlippage,
    LiquidityDistribution.SPOT,
    client
  );

  const len = 70;
  const x = 0.0142857;
  const evenDistribution = Array(len)
    .fill(x)
    .map((el) => parseEther(el.toString()));
  const emptyDistribution = Array(len)
    .fill(0)
    .map((el) => parseEther(el.toString()));

  const firstId = 416;

  for (let i = 0; i < 10; i++) {
    const deltaIds = Array.from(
      { length: len },
      (_, j) => j + (firstId - i * len)
    );
    let distributionX = i < 6 ? evenDistribution : emptyDistribution;
    let distributionY = i < 6 ? emptyDistribution : evenDistribution;

    if (i === 6) {
      //   const activeBinAmmountSlippage = new Percent(500n, 10_000n);
      console.log(deltaIds);
      addLiquidityInput = await pair.addLiquidityParameters(
        LBPair,
        binStep,
        tokenAmount2,
        wmasAmount2,
        amountSlippage,
        priceSlippage,
        LiquidityDistribution.SPOT,
        client
      );
      distributionX = Array(4)
        .fill(0)
        .concat(Array(66).fill(0.0151515))
        .map((el) => parseEther(el.toString()));
      distributionY = Array(5)
        .fill(0.2)
        .concat(Array(65).fill(0))
        .map((el) => parseEther(el.toString()));
    }

    if (i === 7) {
      addLiquidityInput = await pair.addLiquidityParameters(
        LBPair,
        binStep,
        tokenAmount3,
        wmasAmount3,
        amountSlippage,
        priceSlippage,
        LiquidityDistribution.SPOT,
        client
      );
    }

    // check if liquidity is already added
    const ids = deltaIds.map((id) => id + activeId);
    const liquidity = await new ILBPair(LBPair, client).getSupplies(ids);
    if (liquidity.some((el) => el > 0)) continue;

    const params = pair.liquidityCallParameters({
      ...addLiquidityInput,
      deltaIds,
      distributionX,
      distributionY,
      activeIdDesired: activeId,
      to: account.address,
      deadline,
    });
    const txId = await router.add(params);
    console.log("txId", txId);

    // wait 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return LBPair;
};
