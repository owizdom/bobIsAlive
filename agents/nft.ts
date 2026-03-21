/**
 * NFT Module — Doodle art on Starknet Sepolia.
 *
 * The organism lists doodles with prices. When a Starknet account
 * is configured and funded, it mints on-chain as proof.
 */

import crypto from "crypto";

// We use dynamic import for starknet to handle API differences
let starknetReady = false;
let starkAccount: any = null;
let starkProvider: any = null;

let accountAddress: string = "";
let chainEnabled = false;
let nextTokenId = 1;

export interface DoodleListing {
  tokenId: number;
  title: string;
  description: string;
  svgFilename: string;
  price: string;
  seller: string;
  buyer: string | null;
  sold: boolean;
  mintTxHash: string | null;
  listedAt: number;
  soldAt: number | null;
  attestation: string;
  chain: string;
}

const listings: DoodleListing[] = [];

export function initNFT(): { enabled: boolean; address: string } {
  const privKey = process.env.STARKNET_PRIVATE_KEY;
  const addr = process.env.STARKNET_ACCOUNT_ADDRESS;
  const rpcUrl = process.env.STARKNET_RPC_URL || "https://free-rpc.nethermind.io/sepolia-juno/v0_7";

  if (!privKey || !addr) {
    // Generate a display address
    const fakeAddr = "0x" + crypto.randomBytes(31).toString("hex");
    accountAddress = fakeAddr;
    console.log(`[NFT] Starknet Sepolia — no account configured`);
    console.log(`[NFT] Set STARKNET_PRIVATE_KEY and STARKNET_ACCOUNT_ADDRESS in .env`);
    console.log(`[NFT] Faucet: https://starknet-faucet.vercel.app`);
    console.log(`[NFT] Doodles will be listed off-chain until account is funded`);
    return { enabled: false, address: fakeAddr };
  }

  try {
    const { RpcProvider, Account } = require("starknet");
    starkProvider = new RpcProvider({ nodeUrl: rpcUrl });
    starkAccount = new Account({ provider: { nodeUrl: rpcUrl }, address: addr, signer: privKey });
    // AVNU SDK needs getChainId on the account
    const { constants } = require("starknet");
    if (!starkAccount.getChainId) {
      starkAccount.getChainId = async () => constants.StarknetChainId.SN_SEPOLIA;
    }
    accountAddress = addr;
    chainEnabled = true;
    starknetReady = true;

    console.log(`[NFT] Starknet Sepolia connected`);
    console.log(`[NFT] Account: ${addr.slice(0, 10)}...${addr.slice(-6)}`);

    return { enabled: true, address: addr };
  } catch (err) {
    console.warn(`[NFT] Starknet init failed: ${err instanceof Error ? err.message : err}`);
    accountAddress = addr;
    return { enabled: false, address: addr };
  }
}

export function getStarkAccount(): any { return starkAccount; }
export function getStarkProvider(): any { return starkProvider; }

export function isNFTEnabled(): boolean {
  return chainEnabled;
}

export function getWalletAddress(): string {
  return accountAddress;
}

export async function getWalletBalance(): Promise<string> {
  if (!starknetReady || !starkAccount) return "0";
  try {
    // STRK contract on Starknet
    const ethAddr = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    const { CallData } = require("starknet");
    const result = await starkProvider.callContract({
      contractAddress: ethAddr,
      entrypoint: "balanceOf",
      calldata: CallData.compile({ account: accountAddress }),
    });
    const bal = BigInt(result[0]) + (BigInt(result[1] || 0) << 128n);
    return (Number(bal) / 1e18).toFixed(6);
  } catch { return "0"; }
}

export async function listDoodle(
  title: string,
  description: string,
  svgFilename: string,
  attestation: string,
): Promise<DoodleListing> {
  const priceEth = (0.1 + Math.random() * 4.9).toFixed(4);
  const tokenId = nextTokenId++;
  let mintTxHash: string | null = null;

  // On-chain mint: self-transfer as proof
  if (chainEnabled && starkAccount) {
    try {
      const { CallData } = require("starknet");
      const ethAddr = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

      const result = await starkAccount.execute({
        contractAddress: ethAddr,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: accountAddress,
          amount: { low: 1, high: 0 },
        }),
      });

      mintTxHash = result.transaction_hash;
      console.log(`[NFT] Minted #${tokenId} on Starknet: ${mintTxHash?.slice(0, 18)}...`);
    } catch (err: any) {
      console.warn(`[NFT] Mint failed: ${err?.message?.slice(0, 60) || err}`);
    }
  } else {
    console.log(`[NFT] Doodle #${tokenId} listed off-chain`);
  }

  const listing: DoodleListing = {
    tokenId,
    title,
    description,
    svgFilename,
    price: priceEth,
    seller: accountAddress || "organism",
    buyer: null,
    sold: false,
    mintTxHash,
    listedAt: Date.now(),
    soldAt: null,
    attestation,
    chain: "Starknet Sepolia",
  };

  listings.push(listing);
  console.log(`[NFT] Listed: "${title}" for ${priceEth} STRK (token #${tokenId})`);
  return listing;
}

export async function buyDoodle(tokenId: number, buyerAddress: string): Promise<DoodleListing | null> {
  const listing = listings.find(l => l.tokenId === tokenId && !l.sold);
  if (!listing) return null;
  listing.sold = true;
  listing.buyer = buyerAddress;
  listing.soldAt = Date.now();
  console.log(`[NFT] SOLD: "${listing.title}" to ${buyerAddress.slice(0, 10)}...`);
  return listing;
}

export function getListings(): DoodleListing[] {
  return [...listings].sort((a, b) => b.listedAt - a.listedAt);
}

export function getAvailableListings(): DoodleListing[] {
  return listings.filter(l => !l.sold).sort((a, b) => b.listedAt - a.listedAt);
}

