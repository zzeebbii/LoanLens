import type { YearMonth } from '@/domain/dates'
import type { Loan } from '@/domain/loan'
import type { ExtraPaymentEffect, LoanEvent, Scenario } from '@/domain/scenario'

import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentPeriod } from '@/app/hooks/useCurrentPeriod'
import { MonthField } from '@/components/fields/MonthField'
import { Money } from '@/components/Money'
import { Period } from '@/components/Period'
import { Rate } from '@/components/Rate'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { parseYearMonth } from '@/domain/dates'
import { fromMajorUnits } from '@/domain/money'
import { EXTRA_PAYMENT_EFFECTS } from '@/domain/scenario'

/**
 * Builds up a scenario from individual changes.
 *
 * Only overpayments and payment holidays are offered. Rate overrides and balance corrections
 * exist in the engine and belong in a scenario, but they are corrections to *history* rather
 * than what-ifs about the future, and mixing the two in one editor would muddle both. They
 * are better placed on the schedule rows they correct.
 */
type DraftKind =
  | 'RECURRING_EXTRA'
  | 'EXTRA_PAYMENT'
  | 'PAYMENT_HOLIDAY'
  | 'RATE_CAP'
  | 'INSTALMENT_OVERRIDE'

/**
 * An event plus a client-side id.
 *
 * `LoanEvent` has no identity in the domain, and should not — it is structural data the
 * engine folds over. But a list being edited needs stable identity for React keys and, more
 * importantly, so that removing an entry deletes the one that was clicked rather than
 * whatever currently sits at that index.
 */
interface DraftEvent {
  readonly id: string
  readonly event: LoanEvent
}

export function ScenarioEditor({
  loan,
  scenario,
  onSave,
  onCancel,
}: {
  readonly loan: Loan
  readonly scenario: Scenario
  onSave: (scenario: Scenario) => Promise<void> | void
  onCancel: () => void
}) {
  const { t } = useTranslation(['scenarios', 'common'] as const)
  const currentPeriod = useCurrentPeriod()

  const [name, setName] = useState(scenario.name)
  const [drafts, setDrafts] = useState<readonly DraftEvent[]>(() =>
    scenario.events.map((event) => ({ id: crypto.randomUUID(), event })),
  )

  const [kind, setKind] = useState<DraftKind>('RECURRING_EXTRA')
  const [amount, setAmount] = useState('200')
  // Percentages, as a bank quotes them.
  const [capCeiling, setCapCeiling] = useState('3')
  const [capPremium, setCapPremium] = useState('0.35')
  const [effect, setEffect] = useState<ExtraPaymentEffect>('SHORTEN_TERM')
  const [from, setFrom] = useState<string>(currentPeriod)
  const [until, setUntil] = useState<string>('')

  const addEvent = () => {
    const fromPeriod = parseYearMonth(from)
    if (fromPeriod === null) return

    const parsedAmount = Number(amount.replace(',', '.'))
    const untilPeriod: YearMonth | null = until === '' ? null : parseYearMonth(until)

    const add = (event: LoanEvent) => setDrafts([...drafts, { id: crypto.randomUUID(), event }])

    if (kind === 'RATE_CAP') {
      const ceiling = Number(capCeiling.replace(',', '.'))
      const premium = Number(capPremium.replace(',', '.'))
      if (!Number.isFinite(ceiling) || !Number.isFinite(premium) || premium < 0) return

      add({
        kind: 'RATE_CAP',
        ceiling: ceiling / 100,
        premiumBps: premium * 100,
        from: fromPeriod,
        until: untilPeriod,
      })
      return
    }

    if (kind === 'INSTALMENT_OVERRIDE') {
      // Zero would be a payment holiday, which has its own event and its own interest rules.
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return
      add({
        kind: 'INSTALMENT_OVERRIDE',
        from: fromPeriod,
        until: untilPeriod,
        amount: fromMajorUnits(parsedAmount),
      })
      return
    }

    if (kind === 'PAYMENT_HOLIDAY') {
      // A holiday needs a bounded range: an open-ended one is a loan that never amortises.
      if (untilPeriod === null) return
      add({ kind: 'PAYMENT_HOLIDAY', from: fromPeriod, until: untilPeriod, interest: 'PAY' })
      return
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return

    add(
      kind === 'EXTRA_PAYMENT'
        ? {
            kind: 'EXTRA_PAYMENT',
            period: fromPeriod,
            amount: fromMajorUnits(parsedAmount),
            effect,
          }
        : {
            kind: 'RECURRING_EXTRA',
            from: fromPeriod,
            until: untilPeriod,
            amount: fromMajorUnits(parsedAmount),
            effect,
          },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('scenarios:create')}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1">
          <Label htmlFor="scenario-name">{t('scenarios:field.name')}</Label>
          <Input
            id="scenario-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('scenarios:field.namePlaceholder')}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">{t('scenarios:event.addEvent')}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="event-kind">{t('scenarios:event.addEvent')}</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as DraftKind)}>
                <SelectTrigger id="event-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECURRING_EXTRA">
                    {t('scenarios:event.RECURRING_EXTRA')}
                  </SelectItem>
                  <SelectItem value="EXTRA_PAYMENT">
                    {t('scenarios:event.EXTRA_PAYMENT')}
                  </SelectItem>
                  <SelectItem value="PAYMENT_HOLIDAY">
                    {t('scenarios:event.PAYMENT_HOLIDAY')}
                  </SelectItem>
                  <SelectItem value="RATE_CAP">{t('scenarios:event.RATE_CAP')}</SelectItem>
                  <SelectItem value="INSTALMENT_OVERRIDE">
                    {t('scenarios:event.INSTALMENT_OVERRIDE')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind !== 'PAYMENT_HOLIDAY' && kind !== 'RATE_CAP' && (
              <div className="space-y-1">
                <Label htmlFor="event-amount">
                  {kind === 'INSTALMENT_OVERRIDE'
                    ? t('scenarios:field.instalmentAmount')
                    : t('scenarios:field.amount')}
                </Label>
                <Input
                  id="event-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                {kind === 'INSTALMENT_OVERRIDE' && (
                  <p className="text-xs text-muted-foreground">
                    {t('scenarios:field.instalmentAmountHelp')}
                  </p>
                )}
              </div>
            )}

            {kind === 'RATE_CAP' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="event-cap-ceiling">{t('scenarios:field.capCeiling')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="event-cap-ceiling"
                      inputMode="decimal"
                      value={capCeiling}
                      onChange={(event) => setCapCeiling(event.target.value)}
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="event-cap-premium">{t('scenarios:field.capPremium')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="event-cap-premium"
                      inputMode="decimal"
                      value={capPremium}
                      onChange={(event) => setCapPremium(event.target.value)}
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label htmlFor="event-from">{t('scenarios:field.from')}</Label>
              <MonthField
                id="event-from"
                value={from}
                onChange={setFrom}
                monthLabel={t('common:date.month')}
                yearLabel={t('common:date.year')}
              />
            </div>

            {kind !== 'EXTRA_PAYMENT' && (
              <div className="space-y-1">
                <Label htmlFor="event-until">{t('scenarios:field.until')}</Label>
                {/*
                 * An open-ended range is the common case for a standing overpayment, and it
                 * has no month to pick — so it is an explicit choice rather than an empty
                 * field the user has to guess the meaning of.
                 */}
                <div className="flex items-center gap-2">
                  <Switch
                    id="event-until-open"
                    checked={until === ''}
                    onCheckedChange={(open) => setUntil(open ? '' : currentPeriod)}
                  />
                  <label htmlFor="event-until-open" className="text-sm text-muted-foreground">
                    {t('scenarios:field.untilOpenOption')}
                  </label>
                </div>
                {until !== '' && (
                  <MonthField
                    id="event-until"
                    value={until}
                    onChange={setUntil}
                    monthLabel={t('common:date.month')}
                    yearLabel={t('common:date.year')}
                  />
                )}
              </div>
            )}

            {/*
             * Only overpayments have an effect to choose. Forcing the instalment is not a
             * decision about what to do with spare money — it is a correction to what the
             * lender charged, and shortening the term is not on offer.
             */}
            {(kind === 'RECURRING_EXTRA' || kind === 'EXTRA_PAYMENT') && (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="event-effect">{t('scenarios:field.effect')}</Label>
                <Select
                  value={effect}
                  onValueChange={(value) => setEffect(value as ExtraPaymentEffect)}
                >
                  <SelectTrigger id="event-effect">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTRA_PAYMENT_EFFECTS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(`scenarios:effect.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(`scenarios:effect.${effect}_help`)}
                </p>
              </div>
            )}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addEvent}>
            <PlusIcon aria-hidden />
            {t('common:action.add')}
          </Button>
        </div>

        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('scenarios:event.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {drafts.map(({ id, event }) => (
              <li
                key={id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-medium">{t(`scenarios:event.${event.kind}`)}</span>

                {'amount' in event && (
                  <Money amount={event.amount} currency={loan.currency} whole />
                )}

                {event.kind === 'RATE_CAP' && (
                  <span className="tabular">
                    <Rate value={event.ceiling} decimals={2} />
                    {' · '}
                    <Rate value={event.premiumBps / 10_000} decimals={2} />
                  </span>
                )}

                <span className="text-muted-foreground">
                  <Period period={'period' in event ? event.period : event.from} format="short" />
                  {'until' in event && event.until !== null && (
                    <>
                      {' – '}
                      <Period period={event.until} format="short" />
                    </>
                  )}
                </span>

                {'effect' in event && (
                  <span className="text-xs text-muted-foreground">
                    {t(`scenarios:effect.${event.effect}`)}
                  </span>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={t('common:action.delete')}
                  onClick={() => setDrafts(drafts.filter((draft) => draft.id !== id))}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel}>
            {t('common:action.cancel')}
          </Button>
          <Button
            disabled={name.trim().length === 0 || drafts.length === 0}
            onClick={() =>
              void onSave({
                ...scenario,
                name: name.trim(),
                events: drafts.map((draft) => draft.event),
              })
            }
          >
            {t('common:action.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
