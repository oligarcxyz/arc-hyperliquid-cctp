<h1 align="center">Arc ⇄ Hyperliquid, with Circle CCTP V2</h1>

<p align="center">
  Move USDC between Arc and a Hyperliquid account with Circle's Cross-Chain Transfer Protocol.<br>
  Reference code from <a href="https://oligarc.xyz">OligArc</a>'s production front-end.
</p>

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/cctp-flow-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/cctp-flow-light.png">
  <img alt="USDC between Arc and Hyperliquid by Circle CCTP V2. Deposit: the user's wallet on Arc approves and burns through TokenMessengerV2, Circle attests, the CctpForwarder on HyperEVM mints and credits the user's Hyperliquid account. Withdrawal: the user signs sendToEvmWithData, the USDC is burned through CCTP, Circle attests, and MessageTransmitterV2 mints it to the user's wallet on Arc." src="assets/cctp-flow-dark.png" width="100%">
</picture>
</p>

OligArc is a non-custodial trading app on Hyperliquid perps. Money in it is USDC, and USDC moves between Arc and the
user's own Hyperliquid account over Circle CCTP V2, both ways. There is no bridge of our own and no custody: the user's
own wallet signs each transfer, and the funds go from the user's wallet to the user's account and back.

This repository explains the two flows and publishes the code that runs them, taken from the production app.

## Deposit: Arc → Hyperliquid

Two transactions from the user's wallet on Arc. Code: [`src/deposit-arc-to-hyperliquid.js`](src/deposit-arc-to-hyperliquid.js).

1. **Approve.** The wallet approves `TokenMessengerV2` for exactly the amount (skipped when the allowance already covers it).
2. **Burn.** `depositForBurnWithHook` burns the USDC on Arc, with:
   - `destinationDomain` = `19` (HyperEVM)
   - `mintRecipient` = `destinationCaller` = Circle's `CctpForwarder` on HyperEVM
   - `burnToken` = USDC on Arc, `maxFee` = the fee the user agrees to pay, `minFinalityThreshold` = `2000`
   - `hookData` = the forwarding hook below, which names the user's Hyperliquid account

   The app decodes its own calldata and checks every field before the wallet is asked: a wrong `mintRecipient` or
   `destinationCaller` would strand the USDC.
3. **Attest and forward.** Circle attests the burn, and its Forwarding Service submits the mint to the `CctpForwarder`.
4. **Credit.** The forwarder reads the hook and credits the user's Hyperliquid perps balance with the amount minus `maxFee`.

The hook (56 bytes):

| Bytes | Field | Value |
|---|---|---|
| 0–23 | magic | `cctp-forward` in ASCII, zero-padded to 24 bytes |
| 24–27 | version | `uint32` 0 |
| 28–31 | payload length | `uint32` 24 |
| 32–51 | recipient | the user's address on Hyperliquid |
| 52–55 | destination dex | `uint32` 0 = perps |

A new Hyperliquid account pays a one-time 1 USDC activation fee. With CCTP the deposit is credited in full, and the fee is
charged on the account's first outbound action (a withdrawal or a send).

## Withdrawal: Hyperliquid → Arc

One signature from the user's own wallet, never from a trading key. Code: [`src/withdraw-hyperliquid-to-arc.js`](src/withdraw-hyperliquid-to-arc.js).

- **A · Sign.** The wallet signs the Hyperliquid action `sendToEvmWithData` as EIP-712 typed data
  (`eth_signTypedData_v4`). The app recovers the signer and checks it is the user before anything is sent to
  Hyperliquid's `POST /exchange`.
- **B · Burn.** Hyperliquid sends the USDC out through CCTP. In the user's Hyperliquid history it shows as a send to the
  USDC system address `0x2000…0000`.
- **C · Attest.** Circle attests the burn, and its Forwarding Service calls `receiveMessage` on `MessageTransmitterV2` on Arc.
- **D · Mint.** The USDC, minus Circle's fee, is minted to the user's own address on Arc.

The typed data:

```text
domain   { name: "HyperliquidSignTransaction", version: "1", chainId: <signatureChainId>, verifyingContract: 0x0 }
primary  HyperliquidTransaction:SendToEvmWithData
fields   hyperliquidChain     string   "Mainnet"
         token                string   "USDC"
         amount               string   "25.5"          decimal string, no trailing zeros
         sourceDex            string   ""              "" = perps, "spot" = spot (unified accounts)
         destinationRecipient string   0x… lowercase   the user's own address
         addressEncoding      string   "hex"
         destinationChainId   uint32   26              the CCTP DOMAIN of Arc, not its chain id
         gasLimit             uint64   200000
         data                 bytes    0x              Circle forwards it on the destination
         nonce                uint64   <time in ms>    also the nonce of the /exchange request
```

`signatureChainId` is only the EIP-712 domain of the signature. OligArc first asks the wallet to switch to the
destination network, so the prompt shows Arc (`0x13b2`); the USDC goes wherever `destinationChainId` says.

## Constants

| Name | Value | Chain |
|---|---|---|
| USDC | `0x3600000000000000000000000000000000000000`, 6 decimals, also the gas coin | Arc, chain id `5042` |
| `TokenMessengerV2` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | Arc (same address on every CCTP V2 EVM chain) |
| `MessageTransmitterV2` | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | Arc |
| `CctpForwarder` | `0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757` | HyperEVM |
| CCTP domain | `26` | Arc |
| CCTP domain | `19` | HyperEVM |
| `minFinalityThreshold` | `2000` (standard; Arc has no fast transfer) | Arc |
| `depositForBurnWithHook` selector | `0x779b432d` | |

Withdrawals by `sendToEvmWithData` can also go to the other CCTP networks the app lists. `destinationChainId` is the
CCTP domain; the fee is Circle's, as of early October 2026:

| Network | CCTP domain | Withdrawal fee |
|---|---|---|
| **Arc** | **26** | **0.20 USDC** |
| Ethereum | 0 | 1.20 USDC |
| Avalanche · Optimism · Arbitrum · Base · Polygon | 1 · 2 · 3 · 6 · 7 | 0.20 USDC |
| Unichain · Linea · Sonic · World Chain · Monad | 10 · 11 · 13 · 14 · 15 | 0.20 USDC |

## Fees and timings

What we observed on mainnet, with the number of transfers behind each figure:

| Flow | Fee | Time |
|---|---|---|
| **Deposit**, Arc → Hyperliquid | Circle charges the `maxFee` in full. OligArc sets 0.28 USDC; Circle's forwarding fee was about 0.25 USDC in early October 2026. Plus Arc gas, paid in USDC, under 0.01 USDC. | about 7 s from the burn on Arc to the Hyperliquid credit (n = 2 third-party transfers, 3 Oct 2026) |
| **Withdrawal**, Hyperliquid → Arc | 0.20 USDC (Circle), plus a Hyperliquid send fee of about 0.002 USDC | 9–10 s from the signed action to the mint on Arc (n = 2 OligArc withdrawals, 5 Oct 2026) |

These are observations, not guarantees: Circle's fees and attestation times can change.

## On-chain proof

A withdrawal from the official OligArc wallet with the app, on 5 October 2026:

| Step | Time (UTC) | Amount | Transaction |
|---|---|---|---|
| Out of Hyperliquid, `sendToEvmWithData` | 08:47:02 | 2.35 USDC | [`0x35606dfb…0c0045`](https://app.hyperliquid.xyz/explorer/tx/0x35606dfb9928265b36da0445e2056f0201cf00e1342b452dd929194e582c0045) |
| Minted on Arc by `MessageTransmitterV2`, block 24364182 | 08:47:12 | 2.15 USDC | [`0x533af9b4…10fcbed`](https://explorer.arc.io/tx/0x533af9b4ca28a83a7d5a5668a6deb3bb4763e42852c8f0cfa5787e05910fcbed) |

About 10 seconds end to end, and 0.20 USDC to Circle.

## The code

ES modules for [ethers v6](https://docs.ethers.org/v6/). They are excerpts from the production front-end, trimmed to the
CCTP parts and made standalone; they are reference code, not a published package.

| File | Exports |
|---|---|
| [`src/cctp-constants.js`](src/cctp-constants.js) | `CCTP`, `CCTP_NETWORKS`, `CCTP_ARC_MAX_FEE`, `ARC_CHAIN_ID` |
| [`src/deposit-arc-to-hyperliquid.js`](src/deposit-arc-to-hyperliquid.js) | `forwardHookData(user)`, `cctpCalls(amountUnits, user, maxFeeUnits)`, `runCctpDeposit(provider, user, amount)` |
| [`src/withdraw-hyperliquid-to-arc.js`](src/withdraw-hyperliquid-to-arc.js) | `sendToEvmWithDataAction(o)`, `typedData`, `walletTypedDataJson`, `signWithWallet`, `exchangeBody`, `postExchange`, `withdrawToArc(provider, user, amount)` |

`provider` is the user's EIP-1193 wallet (for example `window.ethereum`); `runCctpDeposit` expects it on Arc. The shape
of a call:

```js
import { runCctpDeposit } from "./src/deposit-arc-to-hyperliquid.js";
import { withdrawToArc } from "./src/withdraw-hyperliquid-to-arc.js";

const [user] = await provider.request({ method: "eth_requestAccounts" });
await runCctpDeposit(provider, user, "100"); // approve + depositForBurnWithHook; ~99.72 USDC reach Hyperliquid
await withdrawToArc(provider, user, "50");   // one EIP-712 signature; ~49.80 USDC reach Arc
```

These move real money. Start with small amounts.

### What was checked

Offline, with Node 24 and ethers 6.17.0, no network and no real key:

- `cctpCalls` builds byte-for-byte the `depositForBurnWithHook` calldata of the app's reference (100 USDC, 0.27 USDC fee),
  and `forwardHookData` matches the layout of a real Arc → HyperCore hook seen on chain;
- with a mock wallet, `runCctpDeposit` asks for the allowance, then approve, then burn, waiting for each receipt, and
  refuses an amount not above the fee;
- the `sendToEvmWithData` action, its EIP-712 JSON, its digest and the `/exchange` body are identical to the production
  code's for the same inputs, a production signature recovers to the signer, and a signature from another address is refused.

The wallet and Hyperliquid calls themselves are the production app's, which made the transfers above; this repository's
copy of them was not run against mainnet.

## Links

[oligarc.xyz](https://oligarc.xyz) · [X @oligarcxyz](https://x.com/oligarcxyz) · [olig-token](https://github.com/oligarcxyz/olig-token) ·
Circle CCTP: [developers.circle.com/cctp](https://developers.circle.com/cctp) · Contact: [oligarchelp@gmail.com](mailto:oligarchelp@gmail.com)

## License

[MIT](LICENSE). Copyright (c) 2026 OligArc.
