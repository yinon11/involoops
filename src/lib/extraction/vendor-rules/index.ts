/**
 * Apply vendor-specific extraction rules to PDF text.
 * Vendor rules define custom regex patterns for precise field extraction.
 */

import { parse, isValid } from 'date-fns';
import type { VendorRule } from './types';
import type { ExtractedInvoiceData } from '@/types/invoice';

/**
 * Apply a vendor-specific rule to extract fields from PDF text.
 * Returns a partial ExtractedInvoiceData with only the fields that
 * were successfully extracted using the vendor's patterns.
 */
export function applyVendorRule(
  text: string,
  rule: VendorRule
): Partial<ExtractedInvoiceData> {
  const result: Partial<ExtractedInvoiceData> = {};

  // Apply date selector
  if (rule.dateSelector) {
    try {
      const regex = new RegExp(rule.dateSelector.pattern, 'g');
      const match = regex.exec(text);
      if (match && match[rule.dateSelector.group]) {
        const rawDate = match[rule.dateSelector.group];
        const parsed = parse(rawDate, rule.dateSelector.format, new Date());
        if (isValid(parsed)) {
          result.invoiceDate = parsed.toISOString().split('T')[0];
        }
      }
    } catch (error) {
      console.warn('Vendor date extraction failed:', error);
    }
  }

  // Apply amount selector
  if (rule.amountSelector) {
    try {
      const regex = new RegExp(rule.amountSelector.pattern, 'g');
      const match = regex.exec(text);
      if (match && match[rule.amountSelector.group]) {
        const rawAmount = match[rule.amountSelector.group]
          .replace(/,/g, '')
          .trim();
        let amount = parseFloat(rawAmount);
        if (!isNaN(amount)) {
          if (rule.amountSelector.multiplier) {
            amount *= rule.amountSelector.multiplier;
          }
          result.amount = Math.round(amount * 100) / 100;
        }
      }
    } catch (error) {
      console.warn('Vendor amount extraction failed:', error);
    }
  }

  // Apply VAT selector
  if (rule.vatSelector) {
    try {
      const regex = new RegExp(rule.vatSelector.pattern, 'g');
      const match = regex.exec(text);
      if (match && match[rule.vatSelector.group]) {
        const rawVat = match[rule.vatSelector.group]
          .replace(/,/g, '')
          .trim();
        const vat = parseFloat(rawVat);
        if (!isNaN(vat)) {
          result.vatAmount = Math.round(vat * 100) / 100;
        }
      }
    } catch (error) {
      console.warn('Vendor VAT extraction failed:', error);
    }
  }

  // Apply invoice number selector
  if (rule.invoiceNumberSelector) {
    try {
      const regex = new RegExp(rule.invoiceNumberSelector.pattern, 'g');
      const match = regex.exec(text);
      if (match && match[rule.invoiceNumberSelector.group]) {
        result.invoiceNumber = match[rule.invoiceNumberSelector.group].trim();
      }
    } catch (error) {
      console.warn('Vendor invoice number extraction failed:', error);
    }
  }

  // Apply currency override
  if (rule.currencyOverride) {
    result.currency = rule.currencyOverride;
  }

  // Calculate amount without VAT if we have both
  if (result.amount != null && result.vatAmount != null) {
    result.amountWithoutVat =
      Math.round((result.amount - result.vatAmount) * 100) / 100;
  }

  return result;
}
