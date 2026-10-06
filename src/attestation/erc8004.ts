import { createHash } from 'node:crypto';

/**
 * EIP-8004 Trustless Agents Specification Implementation
 * Standard URI: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
 */

export interface Erc8004AgentCard {
  type: string;
  name: string;
  description: string;
  image?: string;
  services: Array<{
    name: string;
    endpoint: string;
    version?: string;
  }>;
  x402Support: boolean;
  active: boolean;
  registrations: Array<{
    agentId: number;
    agentRegistry: string;
  }>;
  supportedTrust: string[];
}

export interface Erc8004ValidationResponse {
  validatorAddress: string;
  agentId: number;
  requestHash: string;
  response: number; // 0 to 100
  responseURI: string;
  responseHash: string;
  tag: string;
  metrics: {
    effectiveTps: number;
    abortRate: number;
    concurrencyGrade: 'A+' | 'A' | 'B' | 'C' | 'F';
  };
}

export class Erc8004AttestationEngine {
  private validatorAddress: string;

  constructor(validatorAddress: string = '0xParaLensValidator00000000000000000000001') {
    this.validatorAddress = validatorAddress;
  }

  /**
   * Generates the canonical EIP-8004 Agent Card JSON for ParaLens
   */
  public generateAgentCard(agentId: number = 42): Erc8004AgentCard {
    return {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'ParaLens AI Concurrency Guard',
      description: 'Cryptographic Trust & Storage Contention Firewall for Autonomous Agents on Monad Parallel EVM',
      image: 'https://paralens.xyz/paralens_logo.jpg',
      services: [
        {
          name: 'web',
          endpoint: 'https://paralens.xyz'
        },
        {
          name: 'MCP',
          endpoint: 'https://mcp.paralens.xyz/mcp',
          version: '2025-06-18'
        },
        {
          name: 'x402',
          endpoint: 'https://api.paralens.xyz/analyze',
          version: 'v2-eip155-exact'
        }
      ],
      x402Support: true,
      active: true,
      registrations: [
        {
          agentId,
          agentRegistry: 'eip155:10143:0x8004000000000000000000000000000000008004'
        }
      ],
      supportedTrust: ['reputation', 'crypto-economic', 'tee-attestation']
    };
  }

  /**
   * Generates a formal EIP-8004 Validation Response certifying a smart contract's concurrency grade.
   */
  public generateValidationResponse(
    agentId: number,
    contractAddress: string,
    effectiveTps: number,
    abortRate: number
  ): Erc8004ValidationResponse {
    // Score mapping: 0 aborts = 100 score; >90% aborts = 5 score
    const score = Math.max(0, Math.min(100, Math.round(100 - abortRate * 100)));
    let grade: 'A+' | 'A' | 'B' | 'C' | 'F' = 'F';

    if (score >= 95) grade = 'A+';
    else if (score >= 80) grade = 'A';
    else if (score >= 60) grade = 'B';
    else if (score >= 40) grade = 'C';

    const evidencePayload = JSON.stringify({
      contractAddress,
      effectiveTps,
      abortRate,
      grade,
      auditedAt: new Date().toISOString()
    });

    const requestHash = '0x' + createHash('sha256').update(contractAddress).digest('hex');
    const responseHash = '0x' + createHash('sha256').update(evidencePayload).digest('hex');
    const responseURI = `ipfs://bafkrei${responseHash.slice(2, 34)}`;

    return {
      validatorAddress: this.validatorAddress,
      agentId,
      requestHash,
      response: score,
      responseURI,
      responseHash,
      tag: 'PARALENS_CONCURRENCY_V1',
      metrics: {
        effectiveTps,
        abortRate,
        concurrencyGrade: grade
      }
    };
  }
}
