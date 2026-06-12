import { parseAbi, type Address, type Hex } from "viem";

export const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);

export interface IrisAttestation {
  message: Hex;
  attestation: Hex;
}

export function buildIrisMessagesUrl(args: {
  irisBaseUrl: string;
  sourceDomain: number;
  burnTxHash: Hex;
}): string {
  const base = args.irisBaseUrl.replace(/\/$/, "");
  return `${base}/v2/messages/${args.sourceDomain}?transactionHash=${args.burnTxHash}`;
}

export function parseIrisAttestation(body: unknown): IrisAttestation | null {
  const messages = (body as { messages?: unknown[] })?.messages;
  const first = Array.isArray(messages) ? (messages[0] as any) : null;
  if (!first || first.status !== "complete") return null;
  if (typeof first.message !== "string" || typeof first.attestation !== "string") return null;
  return { message: first.message as Hex, attestation: first.attestation as Hex };
}

export async function fetchIrisAttestation(args: {
  irisBaseUrl: string;
  sourceDomain: number;
  burnTxHash: Hex;
  fetchImpl?: typeof fetch;
}): Promise<IrisAttestation | null> {
  const doFetch = args.fetchImpl ?? fetch;
  const res = await doFetch(buildIrisMessagesUrl(args));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`iris_request_failed:${res.status}`);
  return parseIrisAttestation(await res.json());
}

export function receiveMessageCall(args: {
  messageTransmitter: Address;
  message: Hex;
  attestation: Hex;
}) {
  return {
    address: args.messageTransmitter,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "receiveMessage" as const,
    args: [args.message, args.attestation] as const,
  };
}
