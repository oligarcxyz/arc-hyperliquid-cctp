/*
 * Withdrawal: USDC out of Hyperliquid -> the user's wallet on Arc (or another CCTP network), by Hyperliquid's
 * sendToEvmWithData action, which goes out over Circle CCTP V2.
 * The action is user-signed (EIP-712) by the user's OWN wallet, never by a trading/agent key, and sent to
 * Hyperliquid's POST /exchange.
 *
 * Excerpt from OligArc's production front-end (https://oligarc.xyz), as of 5 October 2026. Reference code: trimmed to
 * this action and made standalone; not a published package.
 * MIT License. Copyright (c) 2026 OligArc.
 */
import { TypedDataEncoder, Signature, verifyTypedData } from "ethers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";

function fail(msg) { throw new Error("sendToEvmWithData: " + msg); }
function lowerAddr(a, what) {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) fail((what || "address") + " is not a 0x address: " + a);
  return a.toLowerCase();
}
function u64(n, what) {
  if (typeof n === "bigint") { if (n < 0n || n >= 1n << 64n) fail(what + " out of uint64"); return n; }
  if (!Number.isSafeInteger(n) || n < 0) fail((what || "value") + " must be a non-negative safe integer: " + n);
  return BigInt(n);
}
// A decimal string in canonical form: no exponent, no sign, no trailing zeros ("25.50" -> "25.5").
function decimalToWire(s) {
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) fail("not a plain decimal string: " + s);
  let [i, f = ""] = s.split(".");
  i = i.replace(/^0+(?=\d)/, "");
  f = f.replace(/0+$/, "");
  return f ? i + "." + f : i;
}
// eth_chainId of the wallet ("0x13b2" on Arc) -> signatureChainId
export function chainIdHex(id) {
  const n = typeof id === "string" ? parseInt(id, id.startsWith("0x") ? 16 : 10) : id;
  if (!Number.isSafeInteger(n) || n <= 0) fail("bad chain id " + id);
  return "0x" + n.toString(16);
}

/* ---------------- the EIP-712 type (Hyperliquid user-signed actions) ---------------- */
const f = (pairs) => pairs.map(([name, type]) => ({ name, type }));
export const PRIMARY_TYPE = "HyperliquidTransaction:SendToEvmWithData";
export const SEND_TO_EVM_WITH_DATA_FIELDS = f([["hyperliquidChain", "string"], ["token", "string"], ["amount", "string"], ["sourceDex", "string"],
  ["destinationRecipient", "string"], ["addressEncoding", "string"], ["destinationChainId", "uint32"], ["gasLimit", "uint64"], ["data", "bytes"], ["nonce", "uint64"]]);
const DOMAIN_TYPES = f([["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"]]);

// The action. destinationChainId is the CCTP DOMAIN (Arc 26, Arbitrum 3, Base 6, Ethereum 0...), not the EVM chain id.
// sourceDex "" = perps, "spot" = spot (a unified account keeps its USDC in spot). data "0x" = Circle forwards it on the
// destination, and its fee comes out of what arrives.
//   o = { signatureChainId, token: "USDC", amount: "25.5", sourceDex, destinationRecipient, destinationChainId: 26, nonce: Date.now() }
export function sendToEvmWithDataAction(o) {
  const a = { type: "sendToEvmWithData", signatureChainId: chainIdHex(o.signatureChainId), hyperliquidChain: "Mainnet" };
  if (typeof o.token !== "string" || !o.token) fail("token is required (\"USDC\")");
  a.token = o.token;
  a.amount = decimalToWire(o.amount);
  if (!(Number(a.amount) > 0)) fail("amount must be > 0");
  a.sourceDex = o.sourceDex == null ? "" : String(o.sourceDex);
  const enc = o.addressEncoding == null ? "hex" : o.addressEncoding;
  if (enc !== "hex" && enc !== "base58") fail("addressEncoding must be hex or base58");
  a.destinationRecipient = enc === "hex" ? lowerAddr(o.destinationRecipient, "destinationRecipient") : String(o.destinationRecipient || "");
  if (!a.destinationRecipient) fail("destinationRecipient is required");
  a.addressEncoding = enc;
  const dom = o.destinationChainId;
  if (!Number.isInteger(dom) || dom < 0 || dom > 0xffffffff) fail("destinationChainId must be a uint32 (the CCTP domain)");
  a.destinationChainId = dom;
  a.gasLimit = Number(u64(o.gasLimit == null ? 200000 : o.gasLimit, "gasLimit"));
  const data = o.data == null ? "0x" : String(o.data);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) fail("data must be 0x-hex bytes");
  a.data = data;
  a.nonce = Number(u64(o.nonce, "nonce"));
  return a;
}

export function typedData(action) {
  if (typeof action.signatureChainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(action.signatureChainId)) fail("signatureChainId must be a hex string like 0x13b2");
  const message = {};
  for (const { name } of SEND_TO_EVM_WITH_DATA_FIELDS) {
    if (action[name] === undefined) fail("missing " + name);
    message[name] = action[name];
  }
  return {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: parseInt(action.signatureChainId, 16), verifyingContract: ZERO_ADDRESS },
    types: { [PRIMARY_TYPE]: SEND_TO_EVM_WITH_DATA_FIELDS.map((x) => Object.assign({}, x)) },
    primaryType: PRIMARY_TYPE,
    message,
  };
}
// The JSON string for eth_signTypedData_v4
export function walletTypedDataJson(action) {
  const td = typedData(action);
  return JSON.stringify({ types: Object.assign({ EIP712Domain: DOMAIN_TYPES }, td.types), primaryType: td.primaryType, domain: td.domain, message: td.message });
}
export function digest(action) { const td = typedData(action); return TypedDataEncoder.hash(td.domain, td.types, td.message); }
export function recoverSigner(action, signature) { const td = typedData(action); return verifyTypedData(td.domain, td.types, td.message, signature); }

// eth_signTypedData_v4 in the user's own wallet (EIP-1193). The signer is recovered and checked before anything is sent.
export async function signWithWallet(provider, user, action) {
  const hex = await provider.request({ method: "eth_signTypedData_v4", params: [user, walletTypedDataJson(action)] });
  const s = Signature.from(hex);
  const sig = { r: s.r, s: s.s, v: s.v };
  const who = recoverSigner(action, sig).toLowerCase();
  if (who !== user.toLowerCase()) throw new Error("The wallet signed with " + who + ", not with " + user + ". Nothing was sent.");
  return sig;
}

// The body of POST /exchange: for user-signed actions the request nonce is the action's own nonce.
export function exchangeBody(action, signature) {
  return { action, nonce: action.nonce, signature: { r: signature.r, s: signature.s, v: signature.v } };
}
export async function postExchange(body) {
  const r = await fetch(EXCHANGE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json(); // { status: "ok" | "err", response }
}

// Putting it together: withdraw `amount` USDC to the user's own address on Arc. The wallet signs on the chain it is on
// (OligArc first switches it to the destination network, so the prompt shows Arc); signatureChainId is only the
// EIP-712 domain of the signature, the USDC goes to destinationChainId.
export async function withdrawToArc(provider, user, amount, { sourceDex = "" } = {}) {
  const signatureChainId = chainIdHex(await provider.request({ method: "eth_chainId" }));
  const action = sendToEvmWithDataAction({ signatureChainId, token: "USDC", amount, sourceDex, destinationRecipient: user,
    addressEncoding: "hex", destinationChainId: 26, gasLimit: 200000, data: "0x", nonce: Date.now() });
  const sig = await signWithWallet(provider, user, action);
  return postExchange(exchangeBody(action, sig));
}
