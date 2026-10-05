/*
 * Circle CCTP V2 constants for moving USDC between Arc and Hyperliquid.
 *
 * Excerpt from OligArc's production front-end (https://oligarc.xyz), as of 5 October 2026. Reference code: trimmed to
 * the CCTP parts and made standalone; not a published package.
 * MIT License. Copyright (c) 2026 OligArc.
 */

export const ARC_CHAIN_ID = 5042;

// Deposits from Arc: Circle's TokenMessengerV2 on Arc burns the USDC, and Circle's CctpForwarder on HyperEVM mints it
// and credits the user's HyperCore account (the hook in hookData tells it where).
export const CCTP = Object.freeze({
  TOKEN_MESSENGER: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", // TokenMessengerV2, same address on every EVM chain with CCTP V2
  FORWARDER: "0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757", // HyperEVM CctpForwarder: both mintRecipient AND destinationCaller
  HYPEREVM_DOMAIN: 19,
  ARC_USDC: "0x3600000000000000000000000000000000000000", // USDC on Arc: ERC-20 interface, 6 decimals (also Arc's gas coin)
  ARC_FINALITY: 2000, // minFinalityThreshold: standard. Arc has no fast transfer; burns that asked for 1000 were run at 2000
});

// Withdrawals out of Hyperliquid (sendToEvmWithData): destinationChainId is the CCTP DOMAIN below, not the EVM chain id.
// wfee = Circle's fee in USDC for a withdrawal to that network, as of 5 October 2026 (it can change).
export const CCTP_NETWORKS = [
  { chainId: ARC_CHAIN_ID, name: "Arc", cctp: 26, wfee: 0.2 },
  { chainId: 8453, name: "Base", cctp: 6, wfee: 0.2 },
  { chainId: 42161, name: "Arbitrum", cctp: 3, wfee: 0.2 },
  { chainId: 1, name: "Ethereum", cctp: 0, wfee: 1.2 },
  { chainId: 10, name: "Optimism", cctp: 2, wfee: 0.2 },
  { chainId: 137, name: "Polygon", cctp: 7, wfee: 0.2 },
  { chainId: 43114, name: "Avalanche", cctp: 1, wfee: 0.2 },
  { chainId: 130, name: "Unichain", cctp: 10, wfee: 0.2 },
  { chainId: 59144, name: "Linea", cctp: 11, wfee: 0.2 },
  { chainId: 146, name: "Sonic", cctp: 13, wfee: 0.2 },
  { chainId: 480, name: "World Chain", cctp: 14, wfee: 0.2 },
  { chainId: 143, name: "Monad", cctp: 15, wfee: 0.2 },
];

// The maxFee a deposit from Arc sets, in USDC. Circle's Forwarding Service charges the maxFee IN FULL (what is left
// over pays for gas on the destination), so this is what the user pays. Its forwarding fee was ~0.25 USDC on
// 5 October 2026; 0.28 leaves room.
export const CCTP_ARC_MAX_FEE = 0.28;
