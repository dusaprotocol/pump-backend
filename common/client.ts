import { Client, IProvider, ProviderType } from "@massalabs/massa-web3";
import { CHAIN_URL as url } from "./config";

export const providers: IProvider[] = [
  {
    url,
    type: ProviderType.PUBLIC,
  },
  {
    url,
    type: ProviderType.PRIVATE,
  },
];

export const web3Client: Client = new Client({
  retryStrategyOn: true,
  providers,
});
