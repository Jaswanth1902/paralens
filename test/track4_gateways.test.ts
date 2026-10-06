import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { X402Handler } from '../src/gateway/x402Handler.js';
import { Erc8004AttestationEngine } from '../src/attestation/erc8004.js';
import { AlchemyAdapter } from '../src/adapters/alchemyAdapter.js';

describe('Track 4: Trust, Identity, and AI Infrastructure Gateway', () => {
  it('should emit HTTP 402 challenge when x-payment header is missing', () => {
    const handler = new X402Handler();
    const result = handler.verifyPaymentHeader({});

    assert.equal(result.statusCode, 402);
    assert.equal(result.authorized, false);
    assert.ok(result.challengeHeader);
    assert.ok(result.challengeHeader['WWW-Authenticate'].includes('x402 scheme="v2-eip155-exact"'));
    assert.ok(result.challengeHeader['X-402-Challenge'].includes('https://x402-facilitator.molandak.org'));
  });

  it('should authorize agent requests with valid x-payment header', () => {
    const handler = new X402Handler();
    const result = handler.verifyPaymentHeader({
      'x-402-authorization': 'ERC3009 0xsignature...'
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.authorized, true);
    assert.ok(result.paymentReceipt);
    assert.equal(result.paymentReceipt.settledAmount, '1000');
  });

  it('should generate compliant EIP-8004 Agent Card JSON schema', () => {
    const engine = new Erc8004AttestationEngine();
    const card = engine.generateAgentCard(101);

    assert.equal(card.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    assert.equal(card.name, 'ParaLens AI Concurrency Guard');
    assert.equal(card.x402Support, true);
    assert.equal(card.registrations[0].agentId, 101);
    assert.ok(card.supportedTrust.includes('tee-attestation'));
    assert.ok(card.services.some(s => s.name === 'x402'));
  });

  it('should generate cryptographic EIP-8004 Validation Response scoring concurrency', () => {
    const engine = new Erc8004AttestationEngine();
    
    // High-contention contract (94.8% abort rate) -> Grade F, score 5
    const naiveValidation = engine.generateValidationResponse(
      101,
      '0x1111111111111111111111111111111111111111',
      72,
      0.948
    );
    assert.equal(naiveValidation.response, 5);
    assert.equal(naiveValidation.metrics.concurrencyGrade, 'F');
    assert.equal(naiveValidation.tag, 'PARALENS_CONCURRENCY_V1');

    // Optimized sharded contract (0.3% abort rate) -> Grade A+, score 100
    const shardedValidation = engine.generateValidationResponse(
      101,
      '0x2222222222222222222222222222222222222222',
      9820,
      0.003
    );
    assert.equal(shardedValidation.response, 100);
    assert.equal(shardedValidation.metrics.concurrencyGrade, 'A+');
    assert.ok(shardedValidation.responseHash.startsWith('0x'));
  });

  it('should verify contract bytecode limits and calculate MIP-8 storage pages via Alchemy adapter', async () => {
    const alchemy = new AlchemyAdapter({ fallbackOffline: true });
    
    const bytecodeInfo = await alchemy.getBytecode('0x1111111111111111111111111111111111111111');
    assert.equal(bytecodeInfo.isWithinMonadLimit, true);

    const proof = await alchemy.getStorageProof('0x1111111111111111111111111111111111111111', '0x80'); // Slot 128 = Page 1
    assert.equal(proof.mip8Page, 1);
  });
});
