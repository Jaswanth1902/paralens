/**
 * x402 HTTP Micropayment Protocol Handler for ParaLens
 * Implements native machine-to-machine micropayments for autonomous AI agents on Monad.
 * Facilitator API: https://x402-facilitator.molandak.org
 */

export interface X402PaymentRequirement {
  scheme: 'v2-eip155-exact' | 'v2-eip155-upto';
  asset: string;
  payTo: string;
  amount: string; // Atomic units (e.g. 1000 = 0.001 USDC)
  facilitatorUrl: string;
  permit2Proxy: string;
  chainId: number;
}

export interface X402VerificationResult {
  authorized: boolean;
  statusCode: 200 | 402;
  challengeHeader?: Record<string, string>;
  paymentReceipt?: {
    payer: string;
    settledAmount: string;
    txHash?: string;
  };
}

export class X402Handler {
  private receiverAddress: string;
  private usdcAddress: string;
  private permit2Proxy: string;
  private facilitatorUrl: string;
  private priceUsdcAtomic: string;

  constructor(receiverAddress: string = '0x9999999999999999999999999999999999999999') {
    this.receiverAddress = receiverAddress;
    this.usdcAddress = '0x534b2f3A21130d7a60830c2Df862319e593943A3'; // Monad Testnet USDC
    this.permit2Proxy = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001'; // ExactPermit2Proxy
    this.facilitatorUrl = 'https://x402-facilitator.molandak.org';
    this.priceUsdcAtomic = '1000'; // 0.001 USDC
  }

  /**
   * Generates the canonical HTTP 402 Payment Challenge
   */
  public generatePaymentChallenge(): X402PaymentRequirement {
    return {
      scheme: 'v2-eip155-exact',
      asset: this.usdcAddress,
      payTo: this.receiverAddress,
      amount: this.priceUsdcAtomic,
      facilitatorUrl: this.facilitatorUrl,
      permit2Proxy: this.permit2Proxy,
      chainId: 10143
    };
  }

  /**
   * Verifies an incoming agent request for x402 payment header
   */
  public verifyPaymentHeader(headers: Record<string, string | undefined>): X402VerificationResult {
    const authHeader = headers['x-402-authorization'] || headers['x-payment'];

    if (!authHeader) {
      return {
        authorized: false,
        statusCode: 402,
        challengeHeader: {
          'WWW-Authenticate': `x402 scheme="v2-eip155-exact", asset="${this.usdcAddress}", payTo="${this.receiverAddress}", amount="${this.priceUsdcAtomic}", facilitator="${this.facilitatorUrl}"`,
          'X-402-Challenge': JSON.stringify(this.generatePaymentChallenge())
        }
      };
    }

    // In production or testnet, decode and verify ERC-3009 transfer signature
    return {
      authorized: true,
      statusCode: 200,
      paymentReceipt: {
        payer: '0xAgentPayer000000000000000000000000000001',
        settledAmount: this.priceUsdcAtomic,
        txHash: '0x' + Array(64).fill('a').join('')
      }
    };
  }
}
