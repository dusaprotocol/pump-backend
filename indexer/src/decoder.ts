import { EventDecoder } from "@dusalabs/sdk";

export type SwapMethod = "buy" | "sell";

export const isSwapMethod = (str: string): str is SwapMethod =>
  str === "buy" || str === "sell";

type SwapEvent = {
  caller: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  to: string;
};
export const decodeSwapEvent = (bytes: string): SwapEvent => {
  const params = EventDecoder.extractParams(bytes);
  return {
    caller: params[0],
    amount0In: EventDecoder.decodeU256(params[1]),
    amount1In: EventDecoder.decodeU256(params[2]),
    amount0Out: EventDecoder.decodeU256(params[3]),
    amount1Out: EventDecoder.decodeU256(params[4]),
    to: params[5],
  };
};
