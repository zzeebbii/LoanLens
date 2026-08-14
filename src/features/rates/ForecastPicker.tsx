import type { ForecastKind } from '@/rates'

import { useTranslation } from 'react-i18next'

import { useSettings } from '@/app/providers/SettingsProvider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FORECAST_KINDS } from '@/rates'

/**
 * Chooses what to assume about rates beyond the published data.
 *
 * A visible, named control rather than a silent default, because the engine refuses to
 * invent a future rate and the choice materially changes every projection. Whatever is
 * picked here is echoed on the charts that depend on it.
 *
 * `CURVE` is deliberately absent: entering a month-by-month path needs a proper editor, and
 * offering it here with nowhere to type would be worse than not offering it.
 */
const OFFERED: readonly ForecastKind[] = FORECAST_KINDS.filter((kind) => kind !== 'CURVE')

export function ForecastPicker() {
  const { t } = useTranslation('rates')
  const { settings, update } = useSettings()
  const forecast = settings.defaultForecast

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="forecast-kind">{t('forecast.title', { period: '' })}</Label>
        <p className="text-xs text-muted-foreground">{t('forecast.explanation')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          value={forecast.kind}
          onValueChange={(kind) => {
            // Each assumption carries different parameters, so switching kind resets to that
            // kind's sensible starting value rather than half-keeping the previous one.
            void update({
              defaultForecast:
                kind === 'SHOCK'
                  ? { kind: 'SHOCK', deltaBps: 100 }
                  : kind === 'FIXED'
                    ? { kind: 'FIXED', rate: 0.03 }
                    : { kind: 'HOLD_LAST' },
            })
          }}
        >
          <SelectTrigger id="forecast-kind" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OFFERED.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`forecast.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {forecast.kind === 'SHOCK' && (
          <div className="space-y-1">
            <Label htmlFor="forecast-shock">{t('sensitivity.shock', { value: '' })}</Label>
            <Input
              id="forecast-shock"
              type="number"
              step={25}
              className="w-28"
              value={forecast.deltaBps}
              onChange={(event) => {
                const deltaBps = Number(event.target.value)
                if (Number.isFinite(deltaBps)) {
                  void update({ defaultForecast: { kind: 'SHOCK', deltaBps } })
                }
              }}
            />
          </div>
        )}

        {forecast.kind === 'FIXED' && (
          <div className="space-y-1">
            <Label htmlFor="forecast-rate">{t('chart.referenceRate')}</Label>
            <Input
              id="forecast-rate"
              type="number"
              step={0.1}
              className="w-28"
              value={Number((forecast.rate * 100).toFixed(4))}
              onChange={(event) => {
                const percent = Number(event.target.value)
                if (Number.isFinite(percent)) {
                  void update({ defaultForecast: { kind: 'FIXED', rate: percent / 100 } })
                }
              }}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t(`forecast.${forecast.kind}_help`)}</p>
    </div>
  )
}
