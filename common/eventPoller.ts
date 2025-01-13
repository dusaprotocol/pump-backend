import { IEvent } from "@massalabs/massa-web3";

export interface IEventPollerResult {
  isError: boolean;
  events: IEvent[];
}

export const MASSA_EXEC_ERROR = "massa_execution_error";
