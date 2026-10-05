/*
 * Deposit: USDC on Arc -> the user's Hyperliquid perps account, by Circle CCTP V2 with the HyperEVM forwarding hook.
 * Two transactions from the user's own wallet on Arc: approve exactly the amount, then depositForBurnWithHook.
 *
 * Excerpt from OligArc's production front-end (https://oligarc.xyz), as of 5 October 2026. Reference code: trimmed to
 * the CCTP parts and made standalone (UI and progress reporting removed); not a published package.
 * MIT License. Copyright (c) 2026 OligArc.
 */
import { Interface } from "ethers";
import { CCTP, CCTP_ARC_MAX_FEE } from "./cctp-constants.js";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const lc = (a) => String(a || "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IFACE = new Interface([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)",
]);

// "12.345678901" -> units as a BigInt, truncated (never rounded up)
export function toUnits(dec, decimals) {
  const [i, f = ""] = dec.split(".");
  return BigInt(i + (f + "0".repeat(decimals)).slice(0, decimals)) || 0n;
}

// hookData for Circle's CctpForwarder (56 bytes):
//   "cctp-forward" magic, right-padded to 24 bytes | version uint32 = 0 | payload length uint32 = 24 (0x18)
//   | payload: the HyperCore recipient (20 bytes) + the destination dex (uint32, 0 = perps)
export function forwardHookData(user) {
  if (!ADDR_RE.test(user)) throw new Error("Bad address.");
  const magic = Array.from("cctp-forward", (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(48, "0");
  return "0x" + magic + "00000000" + "00000018" + lc(user).slice(2) + "00000000";
}

// The two calls of a deposit. Amounts in USDC units (6 decimals).
// A wrong mintRecipient or destinationCaller strands the money for good, so the burn is decoded and checked before
// anything is signed.
export function cctpCalls(amountUnits, user, maxFeeUnits) {
  if (!ADDR_RE.test(user)) throw new Error("Bad address.");
  const pad32 = (a) => "0x" + "0".repeat(24) + lc(a).slice(2);
  const hook = forwardHookData(user);
  const approve = { to: CCTP.ARC_USDC, data: IFACE.encodeFunctionData("approve", [CCTP.TOKEN_MESSENGER, amountUnits]) };
  const burn = { to: CCTP.TOKEN_MESSENGER, data: IFACE.encodeFunctionData("depositForBurnWithHook", [amountUnits, CCTP.HYPEREVM_DOMAIN, pad32(CCTP.FORWARDER), CCTP.ARC_USDC, pad32(CCTP.FORWARDER), maxFeeUnits, CCTP.ARC_FINALITY, hook]) };
  const dec = IFACE.decodeFunctionData("depositForBurnWithHook", burn.data);
  const ok = burn.data.slice(0, 10) === "0x779b432d" && dec[1] === 19n && lc(dec[2]) === lc(pad32(CCTP.FORWARDER)) && lc(dec[4]) === lc(pad32(CCTP.FORWARDER)) && lc(dec[3]) === lc(CCTP.ARC_USDC) &&
    (dec[7].length - 2) / 2 === 56 && lc(dec[7]).slice(66, 106) === lc(user).slice(2) && dec[0] === BigInt(amountUnits) && dec[5] === BigInt(maxFeeUnits);
  if (!ok) throw new Error("The CCTP deposit didn't pass its own checks. Nothing was sent.");
  return { approve, burn, hook };
}

/* ---------------- sending, through the user's EIP-1193 wallet (already on Arc, chain id 5042) ---------------- */
async function sendTx(provider, from, tx) {
  return provider.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data }] });
}
async function waitReceipt(provider, hash, what) {
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    let r = null;
    try { r = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }); } catch (e) { /* the wallet's node: try again */ }
    if (r && r.status != null) {
      if (r.status === "0x1" || r.status === 1 || r.status === "1") return r;
      throw new Error("The " + what + " transaction failed on-chain (reverted).");
    }
    await sleep(1500);
  }
  throw new Error("The " + what + " transaction isn't confirmed yet. Check the wallet's activity before trying again.");
}
async function readAllowance(provider, owner) {
  const data = IFACE.encodeFunctionData("allowance", [owner, CCTP.TOKEN_MESSENGER]);
  const out = await provider.request({ method: "eth_call", params: [{ to: CCTP.ARC_USDC, data }, "latest"] });
  return BigInt(IFACE.decodeFunctionResult("allowance", out)[0]);
}

// amount: a decimal string of USDC ("100"). Returns the transaction hashes. The USDC is credited to `user` on HyperCore.
export async function runCctpDeposit(provider, user, amount, maxFee = CCTP_ARC_MAX_FEE) {
  const X = toUnits(amount, 6);
  const fee = toUnits(String(maxFee), 6);
  if (X <= fee) throw new Error("The amount must be above Circle's " + maxFee.toFixed(2) + " USDC fee.");
  const calls = cctpCalls(X, user, fee);
  let have = 0n;
  try { have = await readAllowance(provider, user); } catch (e) { /* unknown: ask for the approval */ }
  let approveHash = null;
  if (have < X) {
    approveHash = await sendTx(provider, user, calls.approve);
    await waitReceipt(provider, approveHash, "approval");
  }
  const burnHash = await sendTx(provider, user, calls.burn);
  await waitReceipt(provider, burnHash, "deposit");
  return { approveHash, burnHash };
}
