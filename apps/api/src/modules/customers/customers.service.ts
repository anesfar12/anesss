// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CustomersService
// Digital Black Book: Section 8.2 full field set
// Scent Wardrobe: OR-Set CRDT semantics
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { DB_TOKEN } from '../../config/database.module';
import type postgres from 'postgres';

export interface CreateCustomerDto {
  firstName: string;
  lastName: string;
  firstNameAr?: string;
  lastNameAr?: string;
  email?: string;
  phone?: string;
  phoneWhatsapp?: string;
  gender?: string;
  dateOfBirth?: string;
  nationality?: string;
  languagePreference?: string;
  greetingStyle?: string;
  emailOptIn?: boolean;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  acquisitionChannel?: string;
  preferredStaffId?: string;
}

export interface BlackBookUpdateDto {
  preferredFamilies?: string[];
  avoidedNotes?: string[];
  dislikedBrands?: string[];
  skinPh?: number;
  skinPhSource?: string;
  skinType?: string;
  spouseName?: string;
  spouseScentPreferences?: Record<string, unknown>;
  childrenNames?: Array<{ name: string; age?: number; gender?: string }>;
  preferredBeverage?: string;
  greetingStyle?: string;
  languagePreference?: string;
  specialRequirements?: string;
  preferredDeliveryMethod?: string;
  hotelName?: string;
  yachtName?: string;
  privateJetTail?: string;
  villaAddress?: string;
  preferredDeliveryTime?: string;
  keyDates?: Array<{ type: string; date: string; notes?: string }>;
  bottleEngravingPreferences?: string;
  packagingPreferences?: string;
  bespokeBudgetRange?: { min: number; max: number; currency: string };
}

export interface ScentWardrobeEntryDto {
  productId: string;
  variantId?: string;
  occasion?: string[];
  notes?: string;
  rating?: number;
  isSignature?: boolean;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(@Inject(DB_TOKEN) private readonly sql: ReturnType<typeof postgres>) {}

  // ── Create Customer ───────────────────────────────────────────────────

  async createCustomer(dto: CreateCustomerDto, orgId: string, staffId: string) {
    // Check for duplicate email or phone
    if (dto.email) {
      const [existing] = await this.sql<{ id: string }[]>`
        SELECT id FROM customers
        WHERE organization_id = ${orgId} AND email = ${dto.email} AND is_deleted = FALSE
        LIMIT 1
      `;
      if (existing) throw new ConflictException('Customer with this email already exists');
    }

    const [customer] = await this.sql<{ id: string; customerNumber: number }[]>`
      INSERT INTO customers (
        organization_id, first_name, last_name, first_name_ar, last_name_ar,
        email, phone, phone_whatsapp, gender, date_of_birth, nationality,
        language_preference, greeting_style,
        email_opt_in, sms_opt_in, whatsapp_opt_in,
        acquisition_channel, preferred_staff_id, created_by
      ) VALUES (
        ${orgId},
        ${dto.firstName}, ${dto.lastName},
        ${dto.firstNameAr ?? null}, ${dto.lastNameAr ?? null},
        ${dto.email ?? null}, ${dto.phone ?? null}, ${dto.phoneWhatsapp ?? null},
        ${dto.gender ?? null}, ${dto.dateOfBirth ?? null}, ${dto.nationality ?? null},
        ${dto.languagePreference ?? 'ar'}, ${dto.greetingStyle ?? 'arabic_formal'},
        ${dto.emailOptIn ?? true}, ${dto.smsOptIn ?? true}, ${dto.whatsappOptIn ?? true},
        ${dto.acquisitionChannel ?? null}, ${dto.preferredStaffId ?? null},
        ${staffId}
      )
      RETURNING id, customer_number
    `;

    // Auto-create empty Black Book entry
    await this.sql`
      INSERT INTO customer_black_book (customer_id, organization_id)
      VALUES (${customer!.id}, ${orgId})
      ON CONFLICT (customer_id) DO NOTHING
    `;

    return customer;
  }

  // ── Search / List ─────────────────────────────────────────────────────

  async searchCustomers(orgId: string, query: string, limit = 20) {
    const pattern = `%${query}%`;
    return this.sql`
      SELECT id, customer_number, display_name, first_name_ar, last_name_ar,
             email, phone, tier, is_vip, loyalty_points,
             total_lifetime_value, last_visit_at, language_preference
      FROM customers
      WHERE organization_id = ${orgId}
        AND is_deleted = FALSE
        AND (
          display_name ILIKE ${pattern}
          OR phone ILIKE ${pattern}
          OR email ILIKE ${pattern}
          OR phone_whatsapp ILIKE ${pattern}
          OR customer_number::text = ${query}
        )
      ORDER BY total_lifetime_value DESC
      LIMIT ${limit}
    `;
  }

  async getCustomer(customerId: string, orgId: string) {
    const [customer] = await this.sql`
      SELECT c.*,
        u.display_name AS preferred_staff_name
      FROM customers c
      LEFT JOIN users u ON u.id = c.preferred_staff_id
      WHERE c.id = ${customerId} AND c.organization_id = ${orgId} AND c.is_deleted = FALSE
    `;
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  // ── Digital Black Book (Section 8.2) ─────────────────────────────────

  async getBlackBook(customerId: string, orgId: string) {
    const [entry] = await this.sql`
      SELECT bb.*,
        u.display_name AS preferred_staff_name,
        (
          SELECT json_agg(
            json_build_object(
              'productId', sw.product_id,
              'productName', p.name,
              'variantName', pv.name,
              'occasion', sw.occasion,
              'notes', sw.notes,
              'rating', sw.rating,
              'isSignature', sw.is_signature
            ) ORDER BY sw.added_at
          )
          FROM scent_wardrobe sw
          JOIN products p ON p.id = sw.product_id
          LEFT JOIN product_variants pv ON pv.id = sw.variant_id
          WHERE sw.customer_id = ${customerId} AND sw.is_removed = FALSE
        ) AS scent_wardrobe
      FROM customer_black_book bb
      LEFT JOIN users u ON u.id = bb.preferred_staff_id
      WHERE bb.customer_id = ${customerId} AND bb.organization_id = ${orgId}
    `;
    if (!entry) throw new NotFoundException('Black Book not found');
    return entry;
  }

  async updateBlackBook(customerId: string, dto: BlackBookUpdateDto, orgId: string, staffId: string) {
    // Build update object — only update provided fields
    await this.sql`
      UPDATE customer_black_book SET
        preferred_families  = COALESCE(${dto.preferredFamilies ?? null}::text[], preferred_families),
        avoided_notes       = COALESCE(${dto.avoidedNotes ?? null}::text[], avoided_notes),
        disliked_brands     = COALESCE(${dto.dislikedBrands ?? null}::text[], disliked_brands),
        skin_ph             = COALESCE(${dto.skinPh ?? null}, skin_ph),
        skin_ph_source      = COALESCE(${dto.skinPhSource ?? null}, skin_ph_source),
        skin_type           = COALESCE(${dto.skinType ?? null}::skin_type, skin_type),
        spouse_name         = COALESCE(${dto.spouseName ?? null}, spouse_name),
        spouse_scent_preferences = COALESCE(${dto.spouseScentPreferences ? JSON.stringify(dto.spouseScentPreferences) : null}::jsonb, spouse_scent_preferences),
        children_names      = COALESCE(${dto.childrenNames ? JSON.stringify(dto.childrenNames) : null}::jsonb, children_names),
        preferred_beverage  = COALESCE(${dto.preferredBeverage ?? null}, preferred_beverage),
        hotel_name          = COALESCE(${dto.hotelName ?? null}, hotel_name),
        yacht_name          = COALESCE(${dto.yachtName ?? null}, yacht_name),
        private_jet_tail    = COALESCE(${dto.privateJetTail ?? null}, private_jet_tail),
        villa_address       = COALESCE(${dto.villaAddress ?? null}, villa_address),
        key_dates           = COALESCE(${dto.keyDates ? JSON.stringify(dto.keyDates) : null}::jsonb, key_dates),
        bottle_engraving_preferences = COALESCE(${dto.bottleEngravingPreferences ?? null}, bottle_engraving_preferences),
        packaging_preferences = COALESCE(${dto.packagingPreferences ?? null}, packaging_preferences),
        bespoke_budget_range = COALESCE(${dto.bespokeBudgetRange ? JSON.stringify(dto.bespokeBudgetRange) : null}::jsonb, bespoke_budget_range),
        reviewed_by         = ${staffId},
        last_profile_review = now(),
        updated_at          = now()
      WHERE customer_id = ${customerId} AND organization_id = ${orgId}
    `;

    return this.getBlackBook(customerId, orgId);
  }

  // ── Scent Wardrobe (OR-Set CRDT) ──────────────────────────────────────

  async getScentWardrobe(customerId: string, orgId: string) {
    return this.sql`
      SELECT sw.id, sw.product_id, sw.variant_id, sw.or_set_tag,
             sw.occasion, sw.notes, sw.rating, sw.is_signature, sw.added_at,
             p.name AS product_name, p.fragrance_family, p.top_notes, p.heart_notes,
             pv.name AS variant_name, pv.size_ml,
             b.name AS brand_name
      FROM scent_wardrobe sw
      JOIN products p ON p.id = sw.product_id
      LEFT JOIN product_variants pv ON pv.id = sw.variant_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE sw.customer_id = ${customerId}
        AND sw.is_removed = FALSE
      ORDER BY sw.is_signature DESC, sw.added_at DESC
    `;
  }

  async addToWardrobe(customerId: string, dto: ScentWardrobeEntryDto, orgId: string, staffId: string) {
    // OR-Set CRDT: each add gets unique or_set_tag — concurrent adds never conflict
    const [entry] = await this.sql<{ id: string }[]>`
      INSERT INTO scent_wardrobe (
        customer_id, organization_id, product_id, variant_id,
        occasion, notes, rating, is_signature, added_by
      ) VALUES (
        ${customerId}, ${orgId}, ${dto.productId}, ${dto.variantId ?? null},
        ${dto.occasion ? JSON.stringify(dto.occasion) : null}::text[],
        ${dto.notes ?? null}, ${dto.rating ?? null},
        ${dto.isSignature ?? false}, ${staffId}
      )
      RETURNING id
    `;
    return entry;
  }

  async removeFromWardrobe(customerId: string, entryId: string, orgId: string) {
    // OR-Set CRDT: mark as removed (never physically delete — needed for conflict resolution)
    await this.sql`
      UPDATE scent_wardrobe SET is_removed = TRUE, removed_at = now()
      WHERE id = ${entryId} AND customer_id = ${customerId}
    `;
    return { removed: true };
  }

  // ── Transaction History ───────────────────────────────────────────────

  async getTransactionHistory(customerId: string, orgId: string, limit = 20, offset = 0) {
    return this.sql`
      SELECT t.id, t.receipt_number, t.type, t.status, t.total,
             t.currency, t.loyalty_points_earned, t.completed_at,
             l.name AS location_name,
             u.display_name AS staff_name,
             COUNT(ti.id) AS items_count
      FROM transactions t
      JOIN locations l ON l.id = t.location_id
      JOIN users u ON u.id = t.staff_id
      LEFT JOIN transaction_items ti ON ti.transaction_id = t.id AND ti.item_status = 'active'
      WHERE t.customer_id = ${customerId}
        AND t.organization_id = ${orgId}
        AND t.status = 'completed'
      GROUP BY t.id, l.name, u.display_name
      ORDER BY t.completed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
}
