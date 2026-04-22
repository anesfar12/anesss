// LUXE POS v5.1 — BlockchainService (Fix 4: always async BullMQ)
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

interface MintJobData { transactionItemId: string; organizationId: string; }

@Injectable()
export class BlockchainService {
  readonly logger = new Logger(BlockchainService.name);
  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
    private readonly config: ConfigService,
  ) {}

  async getPassport(itemId: string, orgId: string) {
    const [p] = await this.sql`
      SELECT dp.*, pv.sku, p.name AS product_name, b.name AS brand_name
      FROM digital_passports dp
      JOIN product_variants pv ON pv.id = dp.product_variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE dp.transaction_item_id = ${itemId} AND dp.organization_id = ${orgId}
      LIMIT 1`;
    return p;
  }

  async verifyPassport(tokenId: string, orgId: string) {
    const [p] = await this.sql`
      SELECT dp.*, pv.sku, p.name AS product_name
      FROM digital_passports dp
      JOIN product_variants pv ON pv.id = dp.product_variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE dp.token_id = ${tokenId} AND dp.organization_id = ${orgId}
      LIMIT 1`;
    if (!p) return { verified: false, tokenId };
    return { verified: true, tokenId, mintStatus: p['mintStatus'], mintedAt: p['mintedAt'], transactionHash: p['transactionHash'] };
  }

  async processMintJob(data: MintJobData): Promise<void> {
    const { transactionItemId, organizationId } = data;
    this.logger.log(`Minting passport: ${transactionItemId}`);

    await this.sql`UPDATE digital_passports SET mint_status='minting', updated_at=now() WHERE transaction_item_id=${transactionItemId}`;

    try {
      const [item] = await this.sql<{ id: string; productName: string; sku: string; brandName: string; variantName: string; retailPrice: number }[]>`
        SELECT dp.id, p.name AS product_name, pv.sku, b.name AS brand_name, pv.name AS variant_name, pv.retail_price
        FROM digital_passports dp
        JOIN product_variants pv ON pv.id = dp.product_variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE dp.transaction_item_id = ${transactionItemId} LIMIT 1`;

      if (!item) throw new Error('Passport record not found');

      const metadata = {
        name: `LUXE Passport — ${item.productName}`,
        description: `Authentic ${item.brandName} ${item.productName}. Certificate of authenticity on Polygon.`,
        attributes: [
          { trait_type: 'Brand', value: item.brandName },
          { trait_type: 'Product', value: item.productName },
          { trait_type: 'SKU', value: item.sku },
          { trait_type: 'Blockchain', value: 'Polygon' },
          { trait_type: 'Minted', value: new Date().toISOString() },
        ],
      };

      // Dev stubs — production uses ethers.js + Pinata SDK
      const mockCid = `Qm${Buffer.from(transactionItemId).toString('base64').slice(0, 44)}`;
      const mockTokenId = `${Date.now()}`;
      const mockTxHash = `0x${Buffer.from(transactionItemId + Date.now()).toString('hex').slice(0, 64)}`;

      await this.sql`
        UPDATE digital_passports SET
          mint_status='minted', token_id=${mockTokenId},
          token_uri=${'ipfs://' + mockCid}, ipfs_cid=${mockCid},
          transaction_hash=${mockTxHash}, metadata=${JSON.stringify(metadata)},
          minted_at=now(), updated_at=now()
        WHERE transaction_item_id=${transactionItemId}`;

      this.logger.log(`Passport minted: tokenId=${mockTokenId}`);
    } catch (err) {
      this.logger.error(`Mint failed: ${String(err)}`);
      await this.sql`
        UPDATE digital_passports SET mint_status='failed',
          error_message=${String(err)}, retry_count=retry_count+1, updated_at=now()
        WHERE transaction_item_id=${transactionItemId}`;
      throw err;
    }
  }
}

@Processor('blockchain')
export class BlockchainProcessor {
  constructor(private readonly service: BlockchainService) {}
  @Process('mint-passport')
  async handleMint(job: Job<MintJobData>): Promise<void> { await this.service.processMintJob(job.data); }
}
