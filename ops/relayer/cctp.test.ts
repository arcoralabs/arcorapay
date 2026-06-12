import { describe, expect, it } from "vitest";
import { buildIrisMessagesUrl, parseIrisAttestation, receiveMessageCall } from "./cctp";

describe("CCTP adapter", () => {
  it("builds Circle IRIS v2 message URL", () => {
    expect(buildIrisMessagesUrl({
      irisBaseUrl: "https://iris-api-sandbox.circle.com",
      sourceDomain: 6,
      burnTxHash: `0x${"b".repeat(64)}` as `0x${string}`,
    })).toBe(`https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${"0x" + "b".repeat(64)}`);
  });

  it("parses complete attestation response", () => {
    const att = parseIrisAttestation({
      messages: [{ status: "complete", message: "0x1234", attestation: "0xabcd" }],
    });
    expect(att!.message).toBe("0x1234");
    expect(att!.attestation).toBe("0xabcd");
  });

  it("returns null for pending_confirmations status", () => {
    const att = parseIrisAttestation({
      messages: [{ status: "pending_confirmations" }],
    });
    expect(att).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseIrisAttestation({})).toBeNull();
    expect(parseIrisAttestation(null)).toBeNull();
  });

  it("builds receiveMessage call payload", () => {
    const call = receiveMessageCall({
      messageTransmitter: `0x${"1".repeat(40)}` as `0x${string}`,
      message: "0x1234" as `0x${string}`,
      attestation: "0xabcd" as `0x${string}`,
    });
    expect(call.functionName).toBe("receiveMessage");
    expect(call.args).toEqual(["0x1234", "0xabcd"]);
  });
});
