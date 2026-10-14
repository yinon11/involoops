/**
 * Zod validation schemas for invoice-related data.
 */

import { z } from 'zod';

/**
 * Schema for validating invoice form data.
 */
export const invoiceSchema = z.object({
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  vendorName: z
    .string()
    .min(1, 'Vendor name is required')
    .max(200, 'Vendor name is too long'),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(100_000_000, 'Amount is too large'),
  currency: z.enum(['ILS', 'USD', 'EUR', 'GBP'], {
    error: 'Invalid currency',
  }),
  vatAmount: z
    .number()
    .min(0, 'VAT amount cannot be negative')
    .nullable()
    .optional(),
  amountWithoutVat: z
    .number()
    .positive('Amount without VAT must be positive')
    .nullable()
    .optional(),
  invoiceNumber: z
    .string()
    .max(50, 'Invoice number is too long')
    .nullable()
    .optional(),
  description: z
    .string()
    .max(500, 'Description is too long')
    .nullable()
    .optional(),
  type: z.enum(['expense', 'income']),
  categoryId: z.string().uuid('Invalid category ID').nullable().optional(),
});

export type InvoiceFormData = z.infer<typeof invoiceSchema>;

/**
 * Schema for validating upload requests.
 */
export const uploadSchema = z.object({
  file: z.object({
    name: z
      .string()
      .min(1, 'File name is required')
      .refine(
        (name) => name.toLowerCase().endsWith('.pdf'),
        'Only PDF files are supported'
      ),
    size: z
      .number()
      .positive()
      .max(20 * 1024 * 1024, 'File size must not exceed 20MB'),
    type: z.literal('application/pdf', {
      error: 'File must be a PDF',
    }),
  }),
});

export type UploadData = z.infer<typeof uploadSchema>;

/**
 * Schema for validating vendor rule JSON configuration.
 */
export const vendorRuleSchema = z.object({
  vendorId: z.string().min(1, 'Vendor ID is required'),
  identifiers: z
    .array(z.string().min(1))
    .min(1, 'At least one identifier is required'),
  dateSelector: z
    .object({
      pattern: z.string().min(1, 'Pattern is required'),
      group: z.number().int().min(0),
      format: z.string().min(1, 'Date format is required'),
    })
    .optional(),
  amountSelector: z
    .object({
      pattern: z.string().min(1, 'Pattern is required'),
      group: z.number().int().min(0),
      multiplier: z.number().optional(),
    })
    .optional(),
  vatSelector: z
    .object({
      pattern: z.string().min(1, 'Pattern is required'),
      group: z.number().int().min(0),
    })
    .optional(),
  invoiceNumberSelector: z
    .object({
      pattern: z.string().min(1, 'Pattern is required'),
      group: z.number().int().min(0),
    })
    .optional(),
  currencyOverride: z.enum(['ILS', 'USD', 'EUR', 'GBP']).optional(),
});

export type VendorRuleData = z.infer<typeof vendorRuleSchema>;
