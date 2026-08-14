import { useTranslation } from 'react-i18next'

import { useRateProviders } from '@/app/providers/RateProviderContext'
import { useSettings } from '@/app/providers/SettingsProvider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DAY_COUNT_CONVENTIONS } from '@/domain/dates'
import { ForecastPicker } from '@/features/rates/ForecastPicker'
import { DataManagement } from '@/features/settings/DataManagement'
import { translateDynamic } from '@/i18n/dynamicKey'

export function SettingsPage() {
  const { t } = useTranslation(['settings', 'loan', 'common'] as const)
  const { settings, update } = useSettings()
  const registry = useRateProviders()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings:title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings:section.defaults')}</CardTitle>
          <CardDescription>{t('settings:defaults.explanation')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor="default-day-count">{t('settings:defaults.dayCount')}</Label>
            <Select
              value={settings.defaultDayCount}
              onValueChange={(value) =>
                void update({ defaultDayCount: value as typeof settings.defaultDayCount })
              }
            >
              <SelectTrigger id="default-day-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_COUNT_CONVENTIONS.map((convention) => (
                  <SelectItem key={convention} value={convention}>
                    {t(`loan:dayCount.${convention}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`loan:dayCount.${settings.defaultDayCount}_help`)}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="default-rounding">{t('settings:defaults.rounding')}</Label>
            <Select
              value={settings.defaultRounding}
              onValueChange={(value) =>
                void update({ defaultRounding: value as typeof settings.defaultRounding })
              }
            >
              <SelectTrigger id="default-rounding">
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
          </div>

          <div className="space-y-1">
            <Label htmlFor="default-provider">{t('settings:defaults.rateProvider')}</Label>
            <Select
              value={settings.defaultRateProviderId}
              onValueChange={(value) => void update({ defaultRateProviderId: value })}
            >
              <SelectTrigger id="default-provider">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings:defaults.forecast')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ForecastPicker />
        </CardContent>
      </Card>

      <DataManagement />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings:section.about')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t('settings:about.disclaimer')}</p>
          <p>{t('settings:about.rateSource')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
