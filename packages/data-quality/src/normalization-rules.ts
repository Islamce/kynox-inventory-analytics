import type {
  NormalizedDate, NormalizationIssue, NormalizationIssueCode,
} from '@kynox/shared-types';
import type { ClassifyResult } from './transaction-classification';
import type { ColumnDateAnalysis } from './date-normalization';

/**
 * Generalized data-quality rules for the normalization layer. Every finding is
 * row- and column-anchored with the original + normalized value and a specific,
 * human message — never "invalid data".
 */

export interface IssueContext {
  fileName?: string | null;
  sheetName?: string | null;
  datasetId?: number | null;
  columnName?: string | null;
}

function make(
  code: NormalizationIssueCode,
  severity: NormalizationIssue['severity'],
  ctx: IssueContext,
  fields: Partial<NormalizationIssue>,
): NormalizationIssue {
  return {
    code,
    severity,
    fileName: ctx.fileName ?? null,
    sheetName: ctx.sheetName ?? null,
    datasetId: ctx.datasetId ?? null,
    rowNumber: null,
    columnName: ctx.columnName ?? null,
    originalValue: null,
    parsedValue: null,
    normalizedValue: null,
    explanation: '',
    recommendedCorrection: '',
    confidenceScore: 1,
    classificationSource: null,
    blocksImport: false,
    userActionRequired: false,
    ...fields,
  };
}

/** Row-level date findings for a normalized date column. */
export function dateIssues(
  dates: NormalizedDate[],
  analysis: ColumnDateAnalysis,
  ctx: IssueContext,
  opts: { required?: boolean } = {},
): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];
  const column = ctx.columnName ?? dates[0]?.sourceColumnName ?? null;

  if (analysis.mixed) {
    issues.push(make('MIXED_DATE_FORMATS', 'high', { ...ctx, columnName: column }, {
      explanation: `Column "${column}" contains more than one date format (${analysis.formats.join(', ')}). Parsing each row individually; a single standard is recommended.`,
      recommendedCorrection: 'Standardise the source column to one date format, or confirm the intended format for the whole column.',
      confidenceScore: 0.9,
      userActionRequired: true,
    }));
  }

  dates.forEach((nd, i) => {
    const rowCtx = { ...ctx, columnName: column };
    const rowNumber = nd.sourceRowNumber ?? i;
    if (nd.dateParsingStatus === 'empty') {
      if (opts.required) {
        issues.push(make('MISSING_TRANSACTION_DATE', 'high', rowCtx, {
          rowNumber, originalValue: nd.originalDateValue,
          explanation: `Row ${rowNumber + 2}, column "${column}": the transaction date is missing.`,
          recommendedCorrection: 'Provide a transaction/posting date; time-based analytics require it.',
          userActionRequired: true, blocksImport: true,
        }));
      }
      return;
    }
    if (nd.dateParsingStatus === 'ambiguous') {
      issues.push(make('AMBIGUOUS_DATE_FORMAT', 'high', rowCtx, {
        rowNumber, originalValue: nd.originalDateValue, normalizedValue: nd.normalizedDate,
        explanation: `Row ${rowNumber + 2}, column "${column}": value ${String(nd.originalDateValue)} is ambiguous because both DD/MM/YYYY and MM/DD/YYYY are possible. Select the intended file date format.`,
        recommendedCorrection: 'Select the intended date order (DD/MM or MM/DD) for this file; dates recalculate immediately.',
        confidenceScore: nd.dateParsingConfidence, userActionRequired: true, blocksImport: true,
      }));
      return;
    }
    if (nd.dateParsingStatus === 'out_of_range') {
      issues.push(make('OUT_OF_RANGE_DATE', 'medium', rowCtx, {
        rowNumber, originalValue: nd.originalDateValue, normalizedValue: nd.normalizedDate,
        explanation: `Row ${rowNumber + 2}, column "${column}": ${String(nd.originalDateValue)} normalized to ${nd.normalizedDate}, which is outside the supported range.`,
        recommendedCorrection: 'Verify the year; correct obvious typos (e.g. 2062 → 2026).',
        userActionRequired: true,
      }));
      return;
    }
    if (nd.dateParsingStatus === 'invalid') {
      issues.push(make('INVALID_DATE', 'high', rowCtx, {
        rowNumber, originalValue: nd.originalDateValue,
        explanation: `Row ${rowNumber + 2}, column "${column}": ${String(nd.originalDateValue)} is not a recognisable date. ${nd.parsingWarnings.join(' ')}`.trim(),
        recommendedCorrection: 'Correct the value to a valid date, or map this column to a non-date field.',
        userActionRequired: true, blocksImport: true,
      }));
      return;
    }
    if (nd.dateParsingStatus === 'parsed' && nd.parsingWarnings.some((w) => /future/i.test(w))) {
      issues.push(make('FUTURE_DATE_WARNING', 'low', rowCtx, {
        rowNumber, originalValue: nd.originalDateValue, normalizedValue: nd.normalizedDate,
        explanation: `Row ${rowNumber + 2}, column "${column}": ${nd.normalizedDate} is in the future relative to import time.`,
        recommendedCorrection: 'Confirm the date is a genuine future planning date and not a typo.',
        severity: 'low',
      }));
    }
  });

  return issues;
}

/** Row-level classification / sign / direction findings. */
export function classificationIssues(
  results: ClassifyResult[],
  ctx: IssueContext,
): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];
  results.forEach((r, i) => {
    const rowNumber = i;
    if (r.simultaneousReceiptAndConsumption) {
      issues.push(make('SIMULTANEOUS_RECEIPT_AND_CONSUMPTION', 'high', ctx, {
        rowNumber, originalValue: { receipt: r.receiptQuantity, consumption: r.consumptionQuantity },
        explanation: `Row ${rowNumber + 2}: both receipt (${r.receiptQuantity}) and consumption (${r.consumptionQuantity}) are populated. These are not netted automatically.`,
        recommendedCorrection: 'Split into two transactions, or confirm which quantity applies.',
        classificationSource: r.classificationSource, userActionRequired: true, blocksImport: true,
      }));
    }
    if (r.signConflict) {
      issues.push(make('SIGN_CONFLICT', 'medium', ctx, {
        rowNumber, originalValue: r.originalSign, normalizedValue: r.signedQuantity,
        explanation: `Row ${rowNumber + 2}: imported sign (${r.originalSign}) disagrees with the classified stock effect (${r.category}). Normalized to ${r.signedQuantity}.`,
        recommendedCorrection: 'Confirm the transaction category; adjust the source sign if the classification is wrong.',
        classificationSource: r.classificationSource, confidenceScore: r.classificationConfidence, userActionRequired: true,
      }));
    }
    if (r.directionConflict) {
      issues.push(make('DIRECTION_CONFLICT', 'medium', ctx, {
        rowNumber, originalValue: { sign: r.originalSign, direction: r.direction },
        explanation: `Row ${rowNumber + 2}: explicit direction (${r.direction}) contradicts the quantity sign (${r.originalSign}).`,
        recommendedCorrection: 'Verify the direction column against the quantity sign.',
        classificationSource: r.classificationSource, userActionRequired: true,
      }));
    }
    if (r.category === 'UNKNOWN') {
      issues.push(make('UNKNOWN_TRANSACTION_TYPE', 'medium', ctx, {
        rowNumber,
        explanation: `Row ${rowNumber + 2}: the transaction type could not be classified; it is kept visible as UNKNOWN (not forced into receipt/consumption).`,
        recommendedCorrection: 'Map the transaction type or confirm a category for this row.',
        classificationSource: r.classificationSource, userActionRequired: true,
      }));
    } else if (r.classificationConfidence < 0.7 && r.direction !== 'UNKNOWN') {
      issues.push(make('LOW_CONFIDENCE_DIRECTION_CLASSIFICATION', 'low', ctx, {
        rowNumber, normalizedValue: `${r.direction} / ${r.category}`,
        explanation: `Row ${rowNumber + 2}: direction/category classified with low confidence (${r.classificationConfidence}).`,
        recommendedCorrection: 'Confirm the transaction direction for this row.',
        classificationSource: r.classificationSource, confidenceScore: r.classificationConfidence,
      }));
    }
    if (r.parsedQuantity == null && !r.simultaneousReceiptAndConsumption) {
      issues.push(make('MISSING_QUANTITY', 'medium', ctx, {
        rowNumber,
        explanation: `Row ${rowNumber + 2}: quantity is missing or non-numeric.`,
        recommendedCorrection: 'Provide a numeric quantity.',
      }));
    }
  });
  return issues;
}

/** Column-mapping confidence findings (from the import preview). */
export function mappingConfidenceIssues(
  mappings: { originalColumnName: string; detectedCanonicalField: string | null; confidenceScore: number; userConfirmed: boolean }[],
  ctx: IssueContext = {},
): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];
  for (const m of mappings) {
    if (m.detectedCanonicalField && !m.userConfirmed && m.confidenceScore < 0.7) {
      const isDate = /date/i.test(m.detectedCanonicalField);
      issues.push(make(
        isDate ? 'DATE_COLUMN_MAPPING_LOW_CONFIDENCE' : 'LOW_CONFIDENCE_COLUMN_MAPPING',
        'medium',
        { ...ctx, columnName: m.originalColumnName },
        {
          normalizedValue: m.detectedCanonicalField,
          explanation: `Column "${m.originalColumnName}" was mapped to "${m.detectedCanonicalField}" with low confidence (${m.confidenceScore}).`,
          recommendedCorrection: 'Confirm or change this mapping before import.',
          confidenceScore: m.confidenceScore, userActionRequired: true, blocksImport: true,
        },
      ));
    }
  }
  return issues;
}
