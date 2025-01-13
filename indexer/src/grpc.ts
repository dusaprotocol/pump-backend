import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import logger from "../../common/logger";
import {
  NewSlotExecutionOutputsRequest,
  NewFilledBlocksRequest,
  GetScExecutionEventsRequest,
} from "../gen/ts/massa/api/v1/public";
import { PublicServiceClient as MassaServiceClient } from "../gen/ts/massa/api/v1/public.client";
import {
  ExecutionOutputStatus,
  ScExecutionEvent,
  ScExecutionEventStatus,
} from "../gen/ts/massa/model/v1/execution";
import {
  handleNewFilledBlocks,
  handleNewSlotExecutionOutputs,
} from "./helpers";
import { DuplexStreamingCall } from "@protobuf-ts/runtime-rpc";
import { grpcDefaultHost, grpcPort } from "../../common/config";
import { ONE_MINUTE } from "../../common/utils";
import { IEvent, bytesToStr } from "@massalabs/massa-web3";
import { IEventPollerResult, MASSA_EXEC_ERROR } from "../../common/eventPoller";

const createClient = (host: string = grpcDefaultHost) =>
  new MassaServiceClient(
    new GrpcTransport({
      host: `${host}:${grpcPort}`,
      channelCredentials: ChannelCredentials.createInsecure(),
    })
  );

const baseClient = createClient();

// ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║
// ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║
// ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
// ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║

type ExtractFunctionKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [P in keyof T]-?: T[P] extends (...args: any[]) => DuplexStreamingCall
    ? P
    : never;
}[keyof T];
type ClientActions = ExtractFunctionKeys<MassaServiceClient>;

const subscribe = async (
  method: ClientActions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (message: any) => Promise<void>
) => {
  const stream = baseClient[method]();
  stream.requests.send(req);

  logger.info(`${method}:${new Date().toDateString()}`);

  for await (const message of stream.responses) {
    handler(message).catch((err: Error) => {
      logger.warn(err.message);
      logger.warn(err.stack);
    });
  }

  // TODO: catch connection error
  // setTimeout(() => subscribe(client, method, req, handler), ONE_MINUTE);

  return stream;
};

export const subscribeNewFilledBlocks = async () => {
  const req: NewFilledBlocksRequest = {
    filters: [],
  };

  return subscribe("newFilledBlocks", req, handleNewFilledBlocks);
};

export const subscribeNewSlotExecutionOutputs = async () => {
  const req: NewSlotExecutionOutputsRequest = {
    filters: [
      {
        filter: {
          oneofKind: "status",
          status: ExecutionOutputStatus.CANDIDATE,
        },
      },
    ],
  };

  return subscribe(
    "newSlotExecutionOutputs",
    req,
    handleNewSlotExecutionOutputs
  );
};

// ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║
// ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║
// ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
// ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║

const getEvents = async (txId: string): Promise<IEvent[]> => {
  const req: GetScExecutionEventsRequest = {
    filters: [
      {
        filter: { oneofKind: "originalOperationId", originalOperationId: txId },
      },
    ],
  };
  const events = await baseClient
    .getScExecutionEvents(req)
    .then((res) => res.response.events);

  return events.filter((e) => e.context !== undefined).map(transformEvent);
};

const transformEvent = (event: ScExecutionEvent): IEvent => {
  if (!event.context) throw new Error("Missing context");
  return {
    data: bytesToStr(event.data),
    context: {
      block: event.context.blockId?.value || null,
      call_stack: event.context.callStack,
      index_in_slot: Number(event.context.indexInSlot),
      is_error: event.context.isFailure,
      is_final: event.context.status === ScExecutionEventStatus.FINAL,
      origin_operation_id: event.context.originOperationId?.value || null,
      read_only: false,
      slot: {
        period: Number(event.context.originSlot?.period),
        thread: Number(event.context.originSlot?.thread),
      },
    },
  };
};

export const fetchEvents = async (
  txId: string,
  retries = 10
): Promise<IEventPollerResult> => {
  try {
    const events = await getEvents(txId);

    const delay = (11 - retries) * 1000;
    if (events.length === 0 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchEvents(txId, retries - 1);
    }

    const errorEvents: IEvent[] = events.filter((e) =>
      e.data.includes(MASSA_EXEC_ERROR)
    );
    if (errorEvents.length > 0) return { isError: true, events: errorEvents };

    return { isError: false, events };
  } catch (err) {
    logger.error(err);
    return { isError: true, events: [] };
  }
};
