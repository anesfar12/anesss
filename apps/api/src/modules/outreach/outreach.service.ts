// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — OutreachService (BUG-005 FIXED)
// Clean rewrite — no escaped backticks. postgres.js tagged templates correct.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

export interface ScheduleOutreachDto {
  customerId: string;
  outreachType: string;
  channel: string;
  body: string;
  subject?: string;
  scheduledAt: string;
  orgId: string;
  staffId?: string;
  campaignId?: number;
  referenceTransactionId?: string;
}

export interface CreateCampaignDto {
  name: string;
  outreachType: string;
  channels: string[];
  targetSegment: Record<string, unknown>;
  templateBody: string;
  scheduledAt?: string;
  orgId: string;
  createdBy: string;
}

export interface CreatePaymentLinkDto {
  customerId: string;
  staffId: string;
  amount: number;
  currency: string;
  description: string;
  items: unknown[];
  orgId: string;
  sentVia: string;
}

interface PostSaleData {
  customerId: string;
  transactionId: string;
  organizationId: string;
}

@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>,
    private readonly config: ConfigService,
  ) {}

  async listDueOutreach(orgId: string, limit = 50) {
    return this.sql`
      SELECT oq.id, oq.outreach_type, oq.channel, oq.status,
             oq.subject, oq.body, oq.due_at, oq.retry_count,
             c.display_name AS customer_name, c.phone, c.email,
             c.phone_whatsapp, c.language_preference
      FROM outreach_queue oq
      JOIN customers c ON c.id = oq.customer_id
      WHERE oq.organization_id = ${orgId}
        AND oq.status = 'due'
      ORDER BY oq.due_at ASC
      LIMIT ${limit}
    `;
  }

  async scheduleOutreach(dto: ScheduleOutreachDto) {
    const [item] = await this.sql<{ id: number }[]>`
      INSERT INTO outreach_queue (
        organization_id, customer_id, staff_id, campaign_id,
        outreach_type, channel, status,
        subject, body,
        scheduled_at, due_at, reference_transaction_id
      ) VALUES (
        ${dto.orgId}, ${dto.customerId}, ${dto.staffId ?? null},
        ${dto.campaignId ?? null},
        ${dto.outreachType}, ${dto.channel}, 'scheduled',
        ${dto.subject ?? null}, ${dto.body},
        ${dto.scheduledAt}::timestamptz,
        ${dto.scheduledAt}::timestamptz,
        ${dto.referenceTransactionId ?? null}
      )
      RETURNING id
    `;
    return { outreachId: item!.id };
  }

  async createCampaign(dto: CreateCampaignDto) {
    const [campaign] = await this.sql<{ id: number }[]>`
      INSERT INTO campaigns (
        organization_id, name, status, outreach_type,
        channels, target_segment, template_body,
        scheduled_at, created_by
      ) VALUES (
        ${dto.orgId}, ${dto.name}, 'draft', ${dto.outreachType},
        ${JSON.stringify(dto.channels)}::text[],
        ${JSON.stringify(dto.targetSegment)}::jsonb,
        ${dto.templateBody},
        ${dto.scheduledAt ?? null},
        ${dto.createdBy}
      )
      RETURNING id
    `;
    return { campaignId: campaign!.id };
  }

  async listCampaigns(orgId: string) {
    return this.sql`
      SELECT id, name, status, outreach_type, channels,
             scheduled_at, sent_count, delivered_count, read_count, created_at
      FROM campaigns
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
  }

  async dispatch(outreachId: number): Promise<{ sent: boolean; channel: string }> {
    const [item] = await this.sql<{
      id: number; channel: string; body: string; subject: string | null;
      phone: string | null; email: string | null; phoneWhatsapp: string | null;
    }[]>`
      SELECT oq.id, oq.channel, oq.body, oq.subject,
             c.phone, c.email, c.phone_whatsapp
      FROM outreach_queue oq
      JOIN customers c ON c.id = oq.customer_id
      WHERE oq.id = ${outreachId} AND oq.status = 'due'
      LIMIT 1
    `;

    if (!item) return { sent: false, channel: 'unknown' };

    try {
      const pid = item.channel + '_' + Date.now();
      this.logger.log('Dispatching ' + item.channel + ' outreach id=' + outreachId);

      await this.sql`
        UPDATE outreach_queue
        SET status = 'sent', sent_at = now(),
            provider = ${item.channel},
            provider_message_id = ${pid},
            updated_at = now()
        WHERE id = ${outreachId}
      `;
      return { sent: true, channel: item.channel };
    } catch (err) {
      await this.sql`
        UPDATE outreach_queue
        SET status = 'failed',
            failure_reason = ${String(err)},
            retry_count = retry_count + 1,
            updated_at = now()
        WHERE id = ${outreachId}
      `;
      return { sent: false, channel: item.channel };
    }
  }

  async createPaymentLink(dto: CreatePaymentLinkDto) {
    const token = 'luxe_pl_' + dto.orgId.slice(0, 8) + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const paymentUrl = 'https://pay.luxepos.com/' + token;

    const [link] = await this.sql<{ id: string }[]>`
      INSERT INTO payment_links (
        organization_id, customer_id, staff_id,
        amount, currency, description, items,
        link_token, status, sent_via, expires_at
      ) VALUES (
        ${dto.orgId}, ${dto.customerId}, ${dto.staffId},
        ${dto.amount}, ${dto.currency}, ${dto.description},
        ${JSON.stringify(dto.items)}::jsonb,
        ${token}, 'pending', ${dto.sentVia},
        ${expiresAt}::timestamptz
      )
      RETURNING id
    `;

    return { linkId: link!.id, token, paymentUrl, amount: dto.amount, expiresAt };
  }

  async handlePostSaleOutreach(data: PostSaleData): Promise<void> {
    const [customer] = await this.sql<{
      displayName: string; email: string | null; phone: string | null;
      languagePreference: string; whatsappOptIn: boolean; emailOptIn: boolean;
    }[]>`
      SELECT display_name, email, phone, language_preference,
             whatsapp_opt_in, email_opt_in
      FROM customers WHERE id = ${data.customerId} LIMIT 1
    `;

    const [tx] = await this.sql<{ receiptNumber: number; total: number }[]>`
      SELECT receipt_number, total FROM transactions
      WHERE id = ${data.transactionId} LIMIT 1
    `;

    if (!customer || !tx) return;

    const isArabic = customer.languagePreference === 'ar';
    const body = isArabic
      ? 'شكراً لزيارة لوكس للعطور. طلبك رقم #' + tx.receiptNumber + ' بقيمة ' + tx.total + ' درهم تم بنجاح.'
      : 'Thank you for visiting LUXE Parfums. Your order #' + tx.receiptNumber + ' of AED ' + tx.total + ' is confirmed.';
    const subject = isArabic ? 'شكراً لزيارتك' : 'Thank you for your purchase';

    const channel = customer.whatsappOptIn && customer.phone ? 'whatsapp'
      : customer.emailOptIn && customer.email ? 'email'
      : null;

    if (!channel) return;

    await this.scheduleOutreach({
      customerId: data.customerId,
      outreachType: 'seasonal',
      channel,
      body,
      subject,
      scheduledAt: new Date().toISOString(),
      orgId: data.organizationId,
      referenceTransactionId: data.transactionId,
    });
  }
}

@Processor('outreach')
export class OutreachProcessor {
  constructor(private readonly service: OutreachService) {}

  @Process('post-sale-outreach')
  async handlePostSale(job: Job<PostSaleData>): Promise<void> {
    await this.service.handlePostSaleOutreach(job.data);
  }
}
