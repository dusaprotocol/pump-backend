import * as gRPC from "./src/grpc";

// gRPC.retrieveBlocks();
gRPC.subscribeNewFilledBlocks();

// @ts-expect-error: Property 'toJSON' does not exist on type 'BigInt'
BigInt.prototype.toJSON = function (): string {
  return this.toString();
};
