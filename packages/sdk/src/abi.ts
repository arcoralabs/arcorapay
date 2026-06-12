/**
 * V10 gateway ABI (ArcFXGatewayV10 — custody escrow model).
 * Generated: pnpm --filter @arcora/contracts exec forge inspect ArcFXGatewayV10 abi --json
 *
 * V10 key changes vs V9:
 *  - escrows(bytes32) replaces payments(bytes32) — stores amount + claimableAt
 *  - claim(bytes32[]) — permissionless, fee accrued at claim time
 *  - adminRecoverEscrow(bytes32[], address) — admin sweep after deactivation
 *  - reactivateMerchant(address) — admin re-enable
 *  - recordPayerRefund — nonReentrant (L2 fix)
 *  - Custody removes ERC-20 allowance dependency (H4 fix)
 */
export const gatewayAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "protocolFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "refundWindow",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "adminRecoveryDelay",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialRelayer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ADMIN_RECOVERY_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROTOCOL_FEE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REFUND_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RELAYER_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RIGHT_CREATE_INVOICE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RIGHT_REFUND",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "adminRecoverEscrow",
    "inputs": [
      {
        "name": "globalIds",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "authorizeDelegate",
    "inputs": [
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "rights",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "globalIds",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createInvoice",
    "inputs": [
      {
        "name": "merchantInvoiceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createInvoiceFor",
    "inputs": [
      {
        "name": "merchant_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "merchantInvoiceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deactivateMerchant",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "delegates",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "rights",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "escrows",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimableAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoleAdmin",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "grantRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "invoices",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "merchant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ArcFXGatewayV10.InvoiceStatus"
      },
      {
        "name": "paidBy",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "merchants",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolFeesAccrued",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reactivateMerchant",
    "inputs": [
      {
        "name": "merchantAddr",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recordPayerRefund",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payInToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundInvoice",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerMerchant",
    "inputs": [
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "renounceRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "callerConfirmation",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeDelegate",
    "inputs": [
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTokenSupport",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settleInvoice",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payInToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grossPayout",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "swapTxHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportedTokens",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updatePayoutAddress",
    "inputs": [
      {
        "name": "newPayoutAddress",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updatePayoutToken",
    "inputs": [
      {
        "name": "newPayoutToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawFees",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "DelegateAuthorized",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "rights",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DelegateRevoked",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowCreated",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "claimableAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowRecovered",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesWithdrawn",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "InvoiceClaimed",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "toMerchant",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "InvoiceCreated",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "merchantInvoiceId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payIn",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "InvoicePaid",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "grossReceived",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "merchantPayout",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "InvoiceRefunded",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "refundedTo",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "merchantPayout",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "protocolFeeReturned",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MerchantDeactivated",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MerchantPayoutAddressUpdated",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "newAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MerchantPayoutTokenUpdated",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "newToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MerchantReactivated",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MerchantRegistered",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payoutToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PayerRefunded",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payInToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlementContext",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payInToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "swapTxHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenSupportUpdated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "neededRole",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressInsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClaimTooEarly",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "claimableAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "DelegateNotAuthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FailedInnerCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDelegateRights",
    "inputs": [
      {
        "name": "rights",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPayInToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPayoutAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPayoutToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidWindow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvoiceAlreadyExists",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceAlreadyPaid",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceExpired",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceNotClaimable",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceNotFound",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceNotInCreatedState",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceNotRecoverable",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvoiceNotRefundable",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "MerchantAlreadyActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MerchantAlreadyRegistered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MerchantInactive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MerchantStillActive",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotAuthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotMerchant",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PayoutAddressUnset",
    "inputs": [
      {
        "name": "merchant",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PayoutShortfall",
    "inputs": [
      {
        "name": "supplied",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ProtocolFeeTooHigh",
    "inputs": [
      {
        "name": "supplied",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "RecoveryTooEarly",
    "inputs": [
      {
        "name": "globalId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoverableAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const;

// Backward-compat alias used by older call sites (GATEWAY_ABI was the V9 export name).
export const GATEWAY_ABI = gatewayAbi;
