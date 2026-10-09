import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBedrockError } from '../../tools/bedrock/verify.ts';

test('bedrock errors are classified into the brief\'s failure classes', () => {
  const c = (name: string, message = '') => classifyBedrockError({ name, message });
  assert.deepEqual(c('ValidationException', 'Operation not allowed'), { outcome: 'account-not-authorized', stop: true }); // measured 2026-10-08
  assert.equal(c('AccessDeniedException', 'User: arn:aws:iam::x:user/u is not authorized to perform: bedrock:InvokeModel').outcome, 'iam-denied');
  assert.equal(c('AccessDeniedException', "You don't have access to the model with the specified model ID.").outcome, 'model-access-denied');
  assert.equal(c('ValidationException', "Invocation of model ID amazon.nova-micro-v1:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile").outcome, 'needs-inference-profile');
  assert.equal(c('ValidationException', 'The provided model identifier is invalid.').outcome, 'not-in-region-or-invalid-id');
  assert.equal(c('ResourceNotFoundException', 'Model not found').stop, false);
  assert.equal(c('ThrottlingException', 'Too many requests').outcome, 'throttled-or-quota');
  assert.equal(c('ServiceQuotaExceededException').outcome, 'throttled-or-quota');
  assert.equal(c('CredentialsProviderError', 'Could not load credentials').outcome, 'credentials-or-config');
  assert.equal(c('ExpiredTokenException', 'The security token included in the request is expired').outcome, 'credentials-or-config');
  assert.equal(c('Error', 'getaddrinfo ENOTFOUND bedrock-runtime.ap-south-1.amazonaws.com').outcome, 'network');
  assert.equal(c('ServiceUnavailableException').outcome, 'service-error');
  assert.equal(c('Weird').outcome, 'unknown');
});
