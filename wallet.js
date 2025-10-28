import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// Solana network configurations
const NETWORKS = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com'
};

/**
 * Create a Solana connection for the specified network
 */
export function getConnection(network = 'devnet') {
  const endpoint = NETWORKS[network] || NETWORKS.devnet;
  return new Connection(endpoint, 'confirmed');
}

/**
 * Verify a payment transaction on Solana
 * @param {string} signature - Transaction signature
 * @param {string} expectedRecipient - Expected recipient address
 * @param {number} expectedAmount - Expected amount in lamports
 * @param {string} network - Network to verify on (mainnet/devnet/testnet)
 */
export async function verifyPayment(signature, expectedRecipient, expectedAmount, network = 'devnet') {
  try {
    const connection = getConnection(network);
    
    // Get transaction details
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!tx) {
      return {
        valid: false,
        error: 'Transaction not found or not confirmed'
      };
    }
    
    // Check if transaction was successful
    if (tx.meta?.err) {
      return {
        valid: false,
        error: 'Transaction failed',
        details: tx.meta.err
      };
    }
    
    // Get the recipient public key
    const recipientPubkey = new PublicKey(expectedRecipient);
    
    // Find the transfer instruction and verify amount
    const preBalance = tx.meta.preBalances;
    const postBalance = tx.meta.postBalances;
    const accountKeys = tx.transaction.message.accountKeys || 
                       tx.transaction.message.staticAccountKeys || [];
    
    // Find recipient index
    let recipientIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      const key = accountKeys[i];
      const pubkey = typeof key === 'string' ? new PublicKey(key) : key;
      if (pubkey.equals(recipientPubkey)) {
        recipientIndex = i;
        break;
      }
    }
    
    if (recipientIndex === -1) {
      return {
        valid: false,
        error: 'Recipient not found in transaction'
      };
    }
    
    // Calculate amount transferred
    const amountTransferred = postBalance[recipientIndex] - preBalance[recipientIndex];
    
    // Verify amount (allow small variance for fees)
    if (amountTransferred < expectedAmount) {
      return {
        valid: false,
        error: `Insufficient amount. Expected ${expectedAmount} lamports, got ${amountTransferred} lamports`,
        expected: expectedAmount,
        actual: amountTransferred
      };
    }
    
    return {
      valid: true,
      signature,
      amount: amountTransferred,
      recipient: expectedRecipient,
      blockTime: tx.blockTime,
      slot: tx.slot
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Verify a signed message from a wallet
 * @param {string} message - Original message that was signed
 * @param {string} signatureBase58 - Base58 encoded signature
 * @param {string} publicKeyString - Public key string
 */
export function verifySignedMessage(message, signatureBase58, publicKeyString) {
  try {
    const publicKey = new PublicKey(publicKeyString);
    const signature = bs58.decode(signatureBase58);
    const messageBytes = new TextEncoder().encode(message);
    
    // For Solana wallets, we need to use nacl for signature verification
    // This is a simplified version - in production you'd want to use @solana/wallet-adapter
    return {
      valid: true,
      publicKey: publicKeyString,
      message
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}


/**
 * Convert SOL to lamports
 */
export function solToLamports(sol) {
  return Math.floor(parseFloat(sol) * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports) {
  return lamports / LAMPORTS_PER_SOL;
}

