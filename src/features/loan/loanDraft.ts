import type { DayCountConvention } from '@/domain/dates'
import type { Loan, RateRounding, Tenor } from '@/domain/loan'
import type { RoundingMode } from '@/domain/money'
import type { AppSettings } from '@/persistence'

import { z } from 'zod'

import {
  DAY_COUNT_CONVENTIONS,
  formatLocalDate,
  localDate,
  parseLocalDate,
  parseYearMonth,
  yearMonth,
  yearMonthOf,
} from '@/domain/dates'
import { bpsToRate, rateToBps, TENORS } from '@/domain/loan'
import { parseMoney, ZERO } from '@/domain/money'
import { toDecimalString as moneyToDecimalString } from '@/i18n/format'

/**
 * The form's own shape, and the mapping to and from a `Loan`.
 *
 * A form edits strings. Money is typed with a decimal separator the user's keyboard
 * produces, a rate is typed as a percentage rather than a fraction, and a margin is stated
 * in whichever unit the loan agreement uses. Keeping that as its own type means validation
 * errors can point at the field the user actually typed in, and the domain never sees a
 * half-parsed value.
 */

export interface LoanDraft {
  readonly id: string
  readonly name: string
  readonly currency: string
  /** Decimal string in major units, as typed. */
  readonly principal: string
  readonly drawdownDate: string
  readonly firstPaymentPeriod: string
  readonly paymentDay: string
  readonly termMonths: string
  readonly rateKind: 'FIXED' | 'FLOATING'
  /** Percentage, as typed: `3.4` for 3.4%. */
  readonly fixedRatePercent: string
  readonly providerId: string
  readonly tenor: Tenor
  /** Percentage points over the reference: `0.55` for 55 basis points. */
  readonly marginPercent: string
  readonly floorReference: boolean
  readonly resetMonths: string
  readonly firstResetPeriod: string
  readonly roundRate: boolean
  readonly rateDecimals: string
  readonly monthlyServicing: string
  readonly perRateReset: string
  readonly dayCount: DayCountConvention
  readonly rounding: RoundingMode
}

/** A decimal string the user could plausibly have typed, in either separator convention. */
const decimalString = (message: string) =>
  z.string().refine((value) => parseMoney(value) !== null, message)

const percentString = (message: string, { min, max }: { min: number; max: number }) =>
  z
    .string()
    .refine((value) => value.trim().length > 0, message)
    .refine((value) => {
      const asNumber = Number(value.replace(',', '.'))
      return Number.isFinite(asNumber) && asNumber >= min && asNumber <= max
    }, message)

/**
 * Validation, with messages as i18n keys.
 *
 * The resolver produces keys rather than sentences so the form can translate them at render
 * time. A hardcoded English message here would be a user-facing string outside the i18n
 * layer, which is the one thing this codebase does not allow.
 */
export const loanDraftSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1, 'loan:validation.nameRequired'),
    currency: z.string().length(3),
    principal: decimalString('loan:validation.principalInvalid').refine((value) => {
      const parsed = parseMoney(value)
      return parsed !== null && parsed > ZERO
    }, 'loan:validation.principalPositive'),
    drawdownDate: z
      .string()
      .refine((value) => parseLocalDate(value) !== null, 'loan:validation.dateInvalid'),
    firstPaymentPeriod: z
      .string()
      .refine((value) => parseYearMonth(value) !== null, 'loan:validation.periodInvalid'),
    paymentDay: z.string().refine((value) => {
      const day = Number(value)
      return Number.isInteger(day) && day >= 1 && day <= 31
    }, 'loan:validation.paymentDayRange'),
    termMonths: z
      .string()
      .refine((value) => {
        const months = Number(value)
        return Number.isInteger(months) && months >= 1
      }, 'loan:validation.termPositive')
      .refine((value) => Number(value) <= 600, 'loan:validation.termTooLong'),
    rateKind: z.enum(['FIXED', 'FLOATING']),
    fixedRatePercent: percentString('loan:validation.rateRange', { min: 0, max: 25 }),
    providerId: z.string().min(1),
    tenor: z.enum(TENORS),
    marginPercent: percentString('loan:validation.marginRange', { min: -5, max: 25 }),
    floorReference: z.boolean(),
    resetMonths: z.string().refine((value) => {
      const months = Number(value)
      return Number.isInteger(months) && months >= 1 && months <= 120
    }, 'loan:validation.termPositive'),
    firstResetPeriod: z
      .string()
      .refine((value) => parseYearMonth(value) !== null, 'loan:validation.periodInvalid'),
    roundRate: z.boolean(),
    rateDecimals: z.string(),
    monthlyServicing: decimalString('loan:validation.principalInvalid'),
    perRateReset: decimalString('loan:validation.principalInvalid'),
    dayCount: z.enum(DAY_COUNT_CONVENTIONS),
    rounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']),
  })
  .refine(
    (draft) => {
      const drawdown = parseLocalDate(draft.drawdownDate)
      const firstPayment = parseYearMonth(draft.firstPaymentPeriod)
      if (drawdown === null || firstPayment === null) return true
      // Interest accrues from drawdown to the first instalment, so a first instalment
      // before drawdown would produce a negative accrual period.
      return yearMonthOf(drawdown) <= firstPayment
    },
    {
      message: 'loan:validation.firstPaymentBeforeDrawdown',
      path: ['firstPaymentPeriod'],
    },
  )

export type ValidatedLoanDraft = z.infer<typeof loanDraftSchema>

function percentToRate(value: string): number {
  return Number(value.replace(',', '.')) / 100
}

function rateToPercentString(rate: number): string {
  // Six decimal places on the percentage: enough for a rate quoted to three decimals plus
  // a margin, without printing float noise.
  return String(Number.parseFloat((rate * 100).toFixed(6)))
}

/** A blank draft, seeded from the user's defaults so they set them once. */
export function emptyLoanDraft(settings: AppSettings, today = new Date()): LoanDraft {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1

  return {
    id: crypto.randomUUID(),
    name: '',
    currency: 'EUR',
    principal: '',
    drawdownDate: formatLocalDate(localDate(year, month, 1)),
    firstPaymentPeriod: yearMonth(year, month),
    paymentDay: '15',
    termMonths: '300',
    rateKind: 'FLOATING',
    fixedRatePercent: '3.4',
    providerId: settings.defaultRateProviderId,
    tenor: '12M',
    marginPercent: '0.55',
    // Defaulted on because most euro-area agreements floor the reference at zero, and a
    // borrower who has not checked is more likely to have a floor than not.
    floorReference: true,
    resetMonths: '12',
    firstResetPeriod: yearMonth(year, month),
    roundRate: false,
    rateDecimals: '3',
    monthlyServicing: '0',
    perRateReset: '0',
    dayCount: settings.defaultDayCount,
    rounding: settings.defaultRounding,
  }
}

export function loanToDraft(loan: Loan): LoanDraft {
  const floating = loan.rateBasis.kind === 'FLOATING' ? loan.rateBasis : null

  return {
    id: loan.id,
    name: loan.name,
    currency: loan.currency,
    principal: moneyToDecimalString(loan.principal),
    drawdownDate: formatLocalDate(loan.drawdownDate),
    firstPaymentPeriod: loan.firstPaymentPeriod,
    paymentDay: String(loan.paymentDay),
    termMonths: String(loan.termMonths),
    rateKind: loan.rateBasis.kind,
    fixedRatePercent:
      loan.rateBasis.kind === 'FIXED' ? rateToPercentString(loan.rateBasis.annualRate) : '3.4',
    providerId: floating?.reference.providerId ?? 'ecb',
    tenor: floating?.reference.tenor ?? '12M',
    marginPercent: rateToPercentString(bpsToRate(floating?.marginBps ?? 55)),
    floorReference: floating?.referenceFloor !== null && floating?.referenceFloor !== undefined,
    resetMonths: String(floating?.resetMonths ?? 12),
    firstResetPeriod: floating?.firstResetPeriod ?? loan.firstPaymentPeriod,
    roundRate: floating?.rateRounding != null,
    rateDecimals: String(floating?.rateRounding?.decimals ?? 3),
    monthlyServicing: moneyToDecimalString(loan.fees.monthlyServicing),
    perRateReset: moneyToDecimalString(loan.fees.perRateReset),
    dayCount: loan.dayCount,
    rounding: loan.rounding,
  }
}

/**
 * Builds a `Loan` from a validated draft.
 *
 * Only ever called with a draft the schema has accepted, so the parses below cannot fail.
 */
export function draftToLoan(draft: ValidatedLoanDraft): Loan {
  const rateRounding: RateRounding | null = draft.roundRate
    ? { decimals: Number(draft.rateDecimals), mode: draft.rounding }
    : null

  return {
    id: draft.id,
    name: draft.name.trim(),
    currency: draft.currency,
    principal: parseMoney(draft.principal) as NonNullable<ReturnType<typeof parseMoney>>,
    drawdownDate: parseLocalDate(draft.drawdownDate) as NonNullable<
      ReturnType<typeof parseLocalDate>
    >,
    firstPaymentPeriod: parseYearMonth(draft.firstPaymentPeriod) as NonNullable<
      ReturnType<typeof parseYearMonth>
    >,
    paymentDay: Number(draft.paymentDay),
    termMonths: Number(draft.termMonths),
    amortization: 'ANNUITY',
    rateBasis:
      draft.rateKind === 'FIXED'
        ? { kind: 'FIXED', annualRate: percentToRate(draft.fixedRatePercent) }
        : {
            kind: 'FLOATING',
            reference: { providerId: draft.providerId, tenor: draft.tenor },
            marginBps: rateToBps(percentToRate(draft.marginPercent)),
            referenceFloor: draft.floorReference ? 0 : null,
            resetMonths: Number(draft.resetMonths),
            firstResetPeriod: parseYearMonth(draft.firstResetPeriod) as NonNullable<
              ReturnType<typeof parseYearMonth>
            >,
            rateRounding,
          },
    fees: {
      monthlyServicing: parseMoney(draft.monthlyServicing) as NonNullable<
        ReturnType<typeof parseMoney>
      >,
      perRateReset: parseMoney(draft.perRateReset) as NonNullable<ReturnType<typeof parseMoney>>,
    },
    dayCount: draft.dayCount,
    rounding: draft.rounding,
  }
}
