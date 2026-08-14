import type { DayCountConvention } from '@/domain/dates'
import type { Loan, Tenor } from '@/domain/loan'
import type { LoanDraft } from '@/features/loan/loanDraft'

import { zodResolver } from '@hookform/resolvers/zod'
import { InfoIcon } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useRateProviders } from '@/app/providers/RateProviderContext'
import { DateField } from '@/components/fields/DateField'
import { MonthField } from '@/components/fields/MonthField'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DAY_COUNT_CONVENTIONS } from '@/domain/dates'
import { TENORS } from '@/domain/loan'
import { FormField } from '@/features/loan/FormField'
import { draftToLoan, loanDraftSchema } from '@/features/loan/loanDraft'
import { translateDynamic } from '@/i18n/dynamicKey'

/**
 * Create and edit a loan.
 *
 * The fields a lender would call "small print" — day count, rate rounding, the reference
 * floor — are first-class and explained, not hidden behind an "advanced" disclosure. They
 * are the difference between a model that matches a statement and one that quietly does not,
 * and the app cannot know their values, so the user has to be asked.
 */
export interface LoanFormProps {
  readonly defaultValues: LoanDraft
  readonly submitLabel: string
  onSubmit: (loan: Loan) => Promise<void> | void
  onCancel: () => void
}

export function LoanForm({ defaultValues, submitLabel, onSubmit, onCancel }: LoanFormProps) {
  const { t } = useTranslation(['loan', 'common', 'rates'] as const)
  const registry = useRateProviders()

  const form = useForm<LoanDraft>({
    defaultValues,
    resolver: zodResolver(loanDraftSchema),
    mode: 'onBlur',
  })

  const rateKind = form.watch('rateKind')
  const roundRate = form.watch('roundRate')

  /** Validation messages are i18n keys; translate at render time. */
  const errorFor = (field: keyof LoanDraft): string | undefined => {
    const message = form.formState.errors[field]?.message
    return message === undefined ? undefined : translateDynamic(t, message)
  }

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (draft) => {
        await onSubmit(draftToLoan(draft))
      })}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('loan:title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <FormField
            label={t('loan:field.name')}
            error={errorFor('name')}
            className="sm:col-span-2"
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('name')}
                placeholder={t('loan:field.namePlaceholder')}
                autoComplete="off"
              />
            )}
          </FormField>

          <FormField label={t('loan:field.principal')} error={errorFor('principal')}>
            {(props) => (
              <Input
                {...props}
                {...form.register('principal')}
                inputMode="decimal"
                placeholder="250000"
                autoComplete="off"
              />
            )}
          </FormField>

          <FormField label={t('loan:field.currency')} error={errorFor('currency')}>
            {(props) => (
              <Input {...props} {...form.register('currency')} maxLength={3} autoComplete="off" />
            )}
          </FormField>

          <Controller
            control={form.control}
            name="drawdownDate"
            render={({ field }) => (
              <FormField
                label={t('loan:field.drawdownDate')}
                help={t('loan:field.drawdownDateHelp')}
                error={errorFor('drawdownDate')}
              >
                {(props) => (
                  <DateField
                    {...props}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              </FormField>
            )}
          />

          <Controller
            control={form.control}
            name="firstPaymentPeriod"
            render={({ field }) => (
              <FormField
                label={t('loan:field.firstPaymentPeriod')}
                error={errorFor('firstPaymentPeriod')}
              >
                {(props) => (
                  <MonthField
                    {...props}
                    value={field.value}
                    onChange={field.onChange}
                    monthLabel={t('common:date.month')}
                    yearLabel={t('common:date.year')}
                  />
                )}
              </FormField>
            )}
          />

          <FormField
            label={t('loan:field.paymentDay')}
            help={t('loan:field.paymentDayHelp')}
            error={errorFor('paymentDay')}
          >
            {(props) => (
              <Input {...props} {...form.register('paymentDay')} type="number" min={1} max={31} />
            )}
          </FormField>

          <FormField
            label={t('loan:field.termMonths')}
            help={t('loan:field.termMonthsHelp')}
            error={errorFor('termMonths')}
          >
            {(props) => (
              <Input {...props} {...form.register('termMonths')} type="number" min={1} max={600} />
            )}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('loan:rate.basis')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="rateKind"
            render={({ field }) => (
              <FormField label={t('loan:rate.basis')} className="sm:col-span-2">
                {(props) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...props}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FLOATING">{t('loan:rate.floating')}</SelectItem>
                      <SelectItem value="FIXED">{t('loan:rate.fixed')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />

          {rateKind === 'FIXED' ? (
            <FormField label={t('loan:rate.annualRate')} error={errorFor('fixedRatePercent')}>
              {(props) => (
                <div className="flex items-center gap-2">
                  <Input
                    {...props}
                    {...form.register('fixedRatePercent')}
                    inputMode="decimal"
                    className="max-w-32"
                  />
                  <span aria-hidden className="text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              )}
            </FormField>
          ) : (
            <>
              <Controller
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormField label={t('loan:rate.provider')}>
                    {(props) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...props}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {registry.list().map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {translateDynamic(t, provider.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                )}
              />

              <Controller
                control={form.control}
                name="tenor"
                render={({ field }) => (
                  <FormField label={t('loan:rate.tenor')}>
                    {(props) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...props}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TENORS.map((tenor: Tenor) => (
                            <SelectItem key={tenor} value={tenor}>
                              {t(`rates:tenor.${tenor}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                )}
              />

              <FormField
                label={t('loan:rate.margin')}
                help={t('loan:rate.marginHelp')}
                error={errorFor('marginPercent')}
              >
                {(props) => (
                  <div className="flex items-center gap-2">
                    <Input
                      {...props}
                      {...form.register('marginPercent')}
                      inputMode="decimal"
                      className="max-w-32"
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                )}
              </FormField>

              <FormField label={t('loan:rate.resetMonths')} error={errorFor('resetMonths')}>
                {(props) => (
                  <Input {...props} {...form.register('resetMonths')} type="number" min={1} />
                )}
              </FormField>

              <Controller
                control={form.control}
                name="firstResetPeriod"
                render={({ field }) => (
                  <FormField
                    label={t('loan:rate.firstResetPeriod')}
                    error={errorFor('firstResetPeriod')}
                  >
                    {(props) => (
                      <MonthField
                        {...props}
                        value={field.value}
                        onChange={field.onChange}
                        monthLabel={t('common:date.month')}
                        yearLabel={t('common:date.year')}
                      />
                    )}
                  </FormField>
                )}
              />

              <Controller
                control={form.control}
                name="floorReference"
                render={({ field }) => (
                  <div className="flex items-start gap-3 sm:col-span-2">
                    <Switch
                      id="floorReference"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <div className="space-y-1">
                      <label htmlFor="floorReference" className="text-sm font-medium">
                        {t('loan:rate.referenceFloor')}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t('loan:rate.referenceFloorHelp')}
                      </p>
                    </div>
                  </div>
                )}
              />

              {/*
               * The cap sits at the end of the rate section because it is a decision layered
               * on top of the basis above it, not part of defining that basis.
               */}
              <Controller
                control={form.control}
                name="hasCap"
                render={({ field }) => (
                  <div className="space-y-3 rounded-lg border p-4 sm:col-span-2">
                    <div className="flex items-start gap-3">
                      <Switch id="hasCap" checked={field.value} onCheckedChange={field.onChange} />
                      <div className="space-y-1">
                        <label htmlFor="hasCap" className="text-sm font-medium">
                          {t('loan:rate.hasCap')}
                        </label>
                        <p className="text-xs text-muted-foreground">{t('loan:rate.capHelp')}</p>
                      </div>
                    </div>

                    {field.value && (
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField
                          label={t('loan:rate.capCeiling')}
                          help={t('loan:rate.capCeilingHelp')}
                          error={errorFor('capCeilingPercent')}
                        >
                          {(props) => (
                            <div className="flex items-center gap-2">
                              <Input
                                {...props}
                                {...form.register('capCeilingPercent')}
                                inputMode="decimal"
                                className="max-w-32"
                              />
                              <span aria-hidden className="text-sm text-muted-foreground">
                                %
                              </span>
                            </div>
                          )}
                        </FormField>

                        <FormField
                          label={t('loan:rate.capPremium')}
                          help={t('loan:rate.capPremiumHelp')}
                          error={errorFor('capPremiumPercent')}
                        >
                          {(props) => (
                            <div className="flex items-center gap-2">
                              <Input
                                {...props}
                                {...form.register('capPremiumPercent')}
                                inputMode="decimal"
                                className="max-w-32"
                              />
                              <span aria-hidden className="text-sm text-muted-foreground">
                                %
                              </span>
                            </div>
                          )}
                        </FormField>

                        <Controller
                          control={form.control}
                          name="capFrom"
                          render={({ field: capFrom }) => (
                            <FormField label={t('loan:rate.capFrom')} error={errorFor('capFrom')}>
                              {(props) => (
                                <MonthField
                                  {...props}
                                  value={capFrom.value}
                                  onChange={capFrom.onChange}
                                  monthLabel={t('common:date.month')}
                                  yearLabel={t('common:date.year')}
                                />
                              )}
                            </FormField>
                          )}
                        />

                        <Controller
                          control={form.control}
                          name="capUntil"
                          render={({ field: capUntil }) => (
                            <FormField label={t('loan:rate.capUntil')} error={errorFor('capUntil')}>
                              {(props) => (
                                <div className="space-y-2">
                                  {/*
                                   * Caps are sold for a fixed term, so an end date is the
                                   * norm — but "to the end of the loan" exists and has no
                                   * month to pick, so it is an explicit choice.
                                   */}
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      id="capOpenEnded"
                                      checked={capUntil.value === ''}
                                      onCheckedChange={(open: boolean) =>
                                        capUntil.onChange(open ? '' : form.getValues('capFrom'))
                                      }
                                    />
                                    <label
                                      htmlFor="capOpenEnded"
                                      className="text-sm text-muted-foreground"
                                    >
                                      {t('loan:rate.capOpenEnded')}
                                    </label>
                                  </div>
                                  {capUntil.value !== '' && (
                                    <MonthField
                                      {...props}
                                      value={capUntil.value}
                                      onChange={capUntil.onChange}
                                      monthLabel={t('common:date.month')}
                                      yearLabel={t('common:date.year')}
                                    />
                                  )}
                                </div>
                              )}
                            </FormField>
                          )}
                        />
                      </div>
                    )}
                  </div>
                )}
              />

              <Controller
                control={form.control}
                name="roundRate"
                render={({ field }) => (
                  <div className="flex items-start gap-3">
                    <Switch id="roundRate" checked={field.value} onCheckedChange={field.onChange} />
                    <label htmlFor="roundRate" className="text-sm font-medium">
                      {t('loan:rate.rateRounding')}
                    </label>
                  </div>
                )}
              />

              {roundRate && (
                <FormField label={t('loan:rate.rateRounding')} error={errorFor('rateDecimals')}>
                  {(props) => (
                    <Input
                      {...props}
                      {...form.register('rateDecimals')}
                      type="number"
                      min={0}
                      max={6}
                    />
                  )}
                </FormField>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('loan:fees.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <FormField label={t('loan:fees.monthlyServicing')} error={errorFor('monthlyServicing')}>
            {(props) => (
              <Input {...props} {...form.register('monthlyServicing')} inputMode="decimal" />
            )}
          </FormField>

          <FormField label={t('loan:fees.perRateReset')} error={errorFor('perRateReset')}>
            {(props) => <Input {...props} {...form.register('perRateReset')} inputMode="decimal" />}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('loan:field.dayCount')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert variant="info">
            <InfoIcon aria-hidden />
            <AlertDescription>{t('loan:dayCountNotice')}</AlertDescription>
          </Alert>

          <Controller
            control={form.control}
            name="dayCount"
            render={({ field }) => (
              <FormField
                label={t('loan:field.dayCount')}
                help={t(`loan:dayCount.${field.value}_help`)}
              >
                {(props) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...props}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_COUNT_CONVENTIONS.map((convention: DayCountConvention) => (
                        <SelectItem key={convention} value={convention}>
                          {t(`loan:dayCount.${convention}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />

          <Controller
            control={form.control}
            name="rounding"
            render={({ field }) => (
              <FormField label={t('loan:field.rounding')}>
                {(props) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...props}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const).map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {t(`loan:rounding.${mode}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common:action.cancel')}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
