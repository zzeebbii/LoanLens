import { useTranslation } from 'react-i18next'

import { splitMonths } from '@/i18n/format'

/**
 * Renders a duration in months as years and months.
 *
 * The parts are pluralised separately through i18next rather than assembled here: "1 year
 * 1 month" versus "2 years 3 months" follows rules that differ by language, and English
 * rules applied everywhere is exactly the bug the i18n layer exists to prevent.
 */
export function Duration({ months }: { readonly months: number }) {
  const { t } = useTranslation()
  const parts = splitMonths(months)

  const yearsLabel = t('units.years', { count: Math.abs(parts.years) })
  const monthsLabel = t('units.months', { count: Math.abs(parts.months) })

  if (parts.years === 0) return <>{monthsLabel}</>
  if (parts.months === 0) return <>{yearsLabel}</>

  return <>{t('units.yearsAndMonths', { years: yearsLabel, months: monthsLabel })}</>
}
