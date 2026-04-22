// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Application Configuration
// General service URLs, third-party integrations
// Blueprint Section 12: Render, Cloudflare R2, Polygon, Pinata, Twilio, Resend
// ═══════════════════════════════════════════════════════════════════════════

import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  // AI microservice (internal — never public-facing)
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',

  // AWS KMS — NFC HMAC-SHA256 key signing (Section 8.3)
  awsKmsKeyId: process.env.AWS_KMS_KEY_ID ?? '',
  awsRegion: process.env.AWS_REGION ?? 'me-south-1',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',

  // Cloudflare R2 — AR asset storage (GLB/USDZ), ~$0/free 10GB
  cloudflareR2Bucket: process.env.CLOUDFLARE_R2_BUCKET ?? '',
  cloudflareR2Endpoint: process.env.CLOUDFLARE_R2_ENDPOINT ?? '',
  cloudflareR2AccessKey: process.env.CLOUDFLARE_R2_ACCESS_KEY ?? '',
  cloudflareR2SecretKey: process.env.CLOUDFLARE_R2_SECRET_KEY ?? '',
  cloudflareCdnUrl: process.env.CLOUDFLARE_CDN_URL ?? '',

  // Blockchain — Polygon mainnet (~$0 public RPC)
  polygonRpcUrl: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
  blockchainPrivateKey: process.env.BLOCKCHAIN_PRIVATE_KEY ?? '',
  passportContractAddress: process.env.PASSPORT_CONTRACT_ADDRESS ?? '',

  // IPFS — Pinata (~$0/free tier)
  pinataApiKey: process.env.PINATA_API_KEY ?? '',
  pinataSecretKey: process.env.PINATA_SECRET_KEY ?? '',
  pinataGateway: process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud',

  // Twilio — WhatsApp + SMS (~$10/mo)
  twilioSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '',
  twilioSmsFrom: process.env.TWILIO_SMS_FROM ?? '',

  // Resend — email (~$0/3k per month)
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'noreply@luxepos.com',

  // Frontend origins for CORS
  posAppUrl: process.env.POS_APP_URL ?? 'http://localhost:3001',
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3002',
  storefrontUrl: process.env.STOREFRONT_URL ?? 'http://localhost:3003',
}));
