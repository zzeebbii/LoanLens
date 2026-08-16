import type { LocalDate, YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { Money } from '@/domain/money'
import type { LoanEvent, Scenario } from '@/domain/scenario'

import { z } from 'zod'

import {
  DAY_COUNT_CONVENTIONS,
  formatLocalDate,
  parseLocalDate,
  parseYearMonth,
} from '@/domain/dates'
import { AMORTIZATION_TYPES, TENORS } from '@/domain/loan'
import { money, toCents } from '@/domain/money'
import { EXTRA_PAYMENT_EFFECTS, HOLIDAY_INTEREST_HANDLING } from '@/domain/scenario'

/**
 * The persisted shape of a loan, and the mapping to and from domain types.
 *
 * A separate representation rather than storing domain objects directly, for two reasons
 * that both cost more to fix later than to do now:
 *
 *  - **`bigint` does not survive JSON.** `JSON.stringify(1n)` throws. Money is stored as a
 *    decimal string of minor units, which is lossless and readable in an exported file.
 *  - **The stored shape is a contract.** Users accumulate data; a domain refactor must not
 *    be able to orphan it. Keeping the two apart means a rename in `domain/` is a change
 *    to one mapping function, not a migration.
 *
 * Everything is validated on the way in. An export file is user-supplied input that may
 * have been hand-edited, truncated, or written by an older version.
 */

/** Integer minor units as a decimal string: `"25000000"` is €250,000.00. */
const moneySchema = z
  .string()
  .regex(/^-?\d+$/, 'Expected whole minor units as a decimal string, e.g. "25000000"')

const yearMonthSchema = z
  .string()
  .refine((value) => parseYearMonth(value) !== null, 'Expected a YYYY-MM period')

const localDateSchema = z
  .string()
  .refine((value) => parseLocalDate(value) !== null, 'Expected a real YYYY-MM-DD date')

const roundingModeSchema = z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'])

const rateSchema = z.number().finite()

const rateCapSchema = z.object({
  ceiling: rateSchema,
  premiumBps: z.number().finite().min(0),
  from: yearMonthSchema,
  until: yearMonthSchema.nullable(),
})

const rateBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FIXED'), annualRate: rateSchema }),
  z.object({
    kind: z.literal('FLOATING'),
    reference: z.object({ providerId: z.string().min(1), tenor: z.enum(TENORS) }),
    marginBps: z.number().finite(),
    referenceFloor: rateSchema.nullable(),
    // Optional so a loan stored before caps existed still loads. Absent means uncapped,
    // which is what those loans were.
    cap: rateCapSchema.nullish().transform((value) => value ?? null),
    resetMonths: z.number().int().positive(),
    firstResetPeriod: yearMonthSchema,
    rateRounding: z
      .object({ decimals: z.number().int().min(0).max(10), mode: roundingModeSchema })
      .nullable(),
  }),
])

export const storedLoanSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  currency: z.string().length(3),
  principal: moneySchema,
  drawdownDate: localDateSchema,
  firstPaymentPeriod: yearMonthSchema,
  paymentDay: z.number().int().min(1).max(31),
  termMonths: z.number().int().positive(),
  amortization: z.enum(AMORTIZATION_TYPES),
  rateBasis: rateBasisSchema,
  fees: z.object({ monthlyServicing: moneySchema, perRateReset: moneySchema }),
  dayCount: z.enum(DAY_COUNT_CONVENTIONS),
  rounding: roundingModeSchema,
})

export type StoredLoan = z.infer<typeof storedLoanSchema>

const extraPaymentEffectSchema = z.enum(EXTRA_PAYMENT_EFFECTS)

const loanEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('EXTRA_PAYMENT'),
    period: yearMonthSchema,
    amount: moneySchema,
    effect: extraPaymentEffectSchema,
  }),
  z.object({
    kind: z.literal('RECURRING_EXTRA'),
    from: yearMonthSchema,
    until: yearMonthSchema.nullable(),
    amount: moneySchema,
    effect: extraPaymentEffectSchema,
  }),
  z.object({
    kind: z.literal('PAYMENT_HOLIDAY'),
    from: yearMonthSchema,
    until: yearMonthSchema,
    interest: z.enum(HOLIDAY_INTEREST_HANDLING),
  }),
  z.object({
    kind: z.literal('RATE_OVERRIDE'),
    from: yearMonthSchema,
    until: yearMonthSchema.nullable(),
    annualRate: rateSchema,
  }),
  z.object({
    kind: z.literal('INSTALMENT_OVERRIDE'),
    from: yearMonthSchema,
    until: yearMonthSchema.nullable(),
    amount: moneySchema,
  }),
  z.object({
    kind: z.literal('RATE_CAP'),
    ceiling: rateSchema,
    premiumBps: z.number().finite().min(0),
    from: yearMonthSchema,
    until: yearMonthSchema.nullable(),
  }),
  z.object({
    kind: z.literal('BALANCE_CORRECTION'),
    period: yearMonthSchema,
    closingBalance: moneySchema,
  }),
])

export type StoredLoanEvent = z.infer<typeof loanEventSchema>

export const storedScenarioSchema = z.object({
  id: z.string().min(1),
  loanId: z.string().min(1),
  name: z.string(),
  events: z.array(loanEventSchema),
  createdAt: z.string().min(1),
})

export type StoredScenario = z.infer<typeof storedScenarioSchema>

/* ------------------------------------------------------------------------- *
 * Mapping
 * ------------------------------------------------------------------------- */

function toStoredMoney(amount: Money): string {
  return toCents(amount).toString()
}

function fromStoredMoney(value: string): Money {
  return money(BigInt(value))
}

/**
 * These two casts are the only place stored strings become branded domain types.
 * The schema has already proved they parse, so re-validating would only add a
 * failure path that cannot be reached.
 */
function asYearMonth(value: string): YearMonth {
  return parseYearMonth(value) as YearMonth
}

function asLocalDate(value: string): LocalDate {
  return parseLocalDate(value) as LocalDate
}

export function toStoredLoan(loan: Loan): StoredLoan {
  return {
    id: loan.id,
    name: loan.name,
    currency: loan.currency,
    principal: toStoredMoney(loan.principal),
    drawdownDate: formatLocalDate(loan.drawdownDate),
    firstPaymentPeriod: loan.firstPaymentPeriod,
    paymentDay: loan.paymentDay,
    termMonths: loan.termMonths,
    amortization: loan.amortization,
    rateBasis: loan.rateBasis,
    fees: {
      monthlyServicing: toStoredMoney(loan.fees.monthlyServicing),
      perRateReset: toStoredMoney(loan.fees.perRateReset),
    },
    dayCount: loan.dayCount,
    rounding: loan.rounding,
  }
}

export function fromStoredLoan(stored: StoredLoan): Loan {
  return {
    id: stored.id,
    name: stored.name,
    currency: stored.currency,
    principal: fromStoredMoney(stored.principal),
    drawdownDate: asLocalDate(stored.drawdownDate),
    firstPaymentPeriod: asYearMonth(stored.firstPaymentPeriod),
    paymentDay: stored.paymentDay,
    termMonths: stored.termMonths,
    amortization: stored.amortization,
    rateBasis:
      stored.rateBasis.kind === 'FIXED'
        ? stored.rateBasis
        : {
            ...stored.rateBasis,
            firstResetPeriod: asYearMonth(stored.rateBasis.firstResetPeriod),
            cap:
              stored.rateBasis.cap === null
                ? null
                : {
                    ...stored.rateBasis.cap,
                    from: asYearMonth(stored.rateBasis.cap.from),
                    until:
                      stored.rateBasis.cap.until === null
                        ? null
                        : asYearMonth(stored.rateBasis.cap.until),
                  },
          },
    fees: {
      monthlyServicing: fromStoredMoney(stored.fees.monthlyServicing),
      perRateReset: fromStoredMoney(stored.fees.perRateReset),
    },
    dayCount: stored.dayCount,
    rounding: stored.rounding,
  }
}

export function toStoredEvent(event: LoanEvent): StoredLoanEvent {
  switch (event.kind) {
    case 'EXTRA_PAYMENT': {
      return { ...event, amount: toStoredMoney(event.amount) }
    }
    case 'RECURRING_EXTRA': {
      return { ...event, amount: toStoredMoney(event.amount) }
    }
    case 'BALANCE_CORRECTION': {
      return { ...event, closingBalance: toStoredMoney(event.closingBalance) }
    }
    case 'INSTALMENT_OVERRIDE': {
      return { ...event, amount: toStoredMoney(event.amount) }
    }
    case 'PAYMENT_HOLIDAY':
    case 'RATE_OVERRIDE':
    case 'RATE_CAP': {
      // No monetary fields; the stored and domain shapes are identical.
      return event
    }
  }
}

export function fromStoredEvent(stored: StoredLoanEvent): LoanEvent {
  switch (stored.kind) {
    case 'EXTRA_PAYMENT': {
      return {
        ...stored,
        period: asYearMonth(stored.period),
        amount: fromStoredMoney(stored.amount),
      }
    }
    case 'RECURRING_EXTRA': {
      return {
        ...stored,
        from: asYearMonth(stored.from),
        until: stored.until === null ? null : asYearMonth(stored.until),
        amount: fromStoredMoney(stored.amount),
      }
    }
    case 'PAYMENT_HOLIDAY': {
      return { ...stored, from: asYearMonth(stored.from), until: asYearMonth(stored.until) }
    }
    case 'RATE_OVERRIDE':
    case 'RATE_CAP': {
      return {
        ...stored,
        from: asYearMonth(stored.from),
        until: stored.until === null ? null : asYearMonth(stored.until),
      }
    }
    case 'INSTALMENT_OVERRIDE': {
      return {
        ...stored,
        from: asYearMonth(stored.from),
        until: stored.until === null ? null : asYearMonth(stored.until),
        amount: fromStoredMoney(stored.amount),
      }
    }
    case 'BALANCE_CORRECTION': {
      return {
        ...stored,
        period: asYearMonth(stored.period),
        closingBalance: fromStoredMoney(stored.closingBalance),
      }
    }
  }
}

export function toStoredScenario(scenario: Scenario): StoredScenario {
  return {
    id: scenario.id,
    loanId: scenario.loanId,
    name: scenario.name,
    events: scenario.events.map(toStoredEvent),
    createdAt: scenario.createdAt,
  }
}

export function fromStoredScenario(stored: StoredScenario): Scenario {
  return {
    id: stored.id,
    loanId: stored.loanId,
    name: stored.name,
    events: stored.events.map(fromStoredEvent),
    createdAt: stored.createdAt,
  }
}
