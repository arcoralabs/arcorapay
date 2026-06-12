export { Arcora } from "./client";
export { ArcoraError, type ArcoraErrorCode } from "./error";
export type * from "./types";
export { gatewayAbi, GATEWAY_ABI } from "./abi";

// v0.8 helpers — for integrators wiring their own checkout UI on top of
// Arcora's relayer-driven settlement instead of using the hosted page.
export {
  buildArcoraSwapIntent, randomNonce, PERMIT2_ADDRESS,
  type BuildArcoraSwapIntentParams,
} from "./permit2";
