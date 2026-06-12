import "dotenv/config";
process.env.NEXT_PUBLIC_USDC_ADDRESS ??= "0x3600000000000000000000000000000000000000";
process.env.NEXT_PUBLIC_EURC_ADDRESS ??= "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
process.env.NEXT_PUBLIC_RELAYER_ADDRESS ??= "0x9999999999999999999999999999999999999999";
// Live testnet gateway (ArcFXGateway, recorded in
// packages/contracts/deployments/arc-testnet.json). Tests use it as a
// stable default; nothing on-chain is touched.
process.env.GATEWAY_ADDRESS ??= "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3";
process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ??= "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3";
// lib/auth/session.ts validates this at module load (audit L-3); give tests a
// deterministic 32+ char default so importing the real session module is safe.
process.env.IRON_SESSION_PASSWORD ??= "test-only-iron-session-password-32chars!!";
process.env.NEXT_PUBLIC_CROSSCHAIN_ENABLED ??= "true";
process.env.CROSSCHAIN_ENABLED_SOURCE_CHAINS ??= "84532,11155111";
process.env.CROSSCHAIN_CHAIN_CONFIG_JSON ??= JSON.stringify({
  "arc-testnet": {
    cctpDomain: 30,
    tokenMessenger: "0x1111111111111111111111111111111111111111",
    messageTransmitter: "0x2222222222222222222222222222222222222222",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    eurcAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
  },
  "base-sepolia": {
    cctpDomain: 6,
    tokenMessenger: "0x3333333333333333333333333333333333333333",
    messageTransmitter: "0x4444444444444444444444444444444444444444",
    usdcAddress: "0x5555555555555555555555555555555555555555"
  },
  "ethereum-sepolia": {
    cctpDomain: 0,
    tokenMessenger: "0x6666666666666666666666666666666666666666",
    messageTransmitter: "0x7777777777777777777777777777777777777777",
    usdcAddress: "0x8888888888888888888888888888888888888888"
  }
});
process.env.BASE_SEPOLIA_RPC ??= "https://base-sepolia.example.invalid";
process.env.ETHEREUM_SEPOLIA_RPC ??= "https://ethereum-sepolia.example.invalid";
process.env.CCTP_IRIS_API_URL ??= "https://iris-api-sandbox.circle.com";
