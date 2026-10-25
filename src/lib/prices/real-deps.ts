import type { PriceDeps } from "./index";
import { coingeckoFetcher } from "./coingecko";
import { yahooFetcher, yahooFx } from "./yahoo";

/** Sources de cours réelles (Yahoo, CoinGecko), partagées par la route et le planificateur. */
export function realPriceDeps(): PriceDeps {
  return { stock: yahooFetcher, crypto: coingeckoFetcher, fx: yahooFx };
}
