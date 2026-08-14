import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function NotFound() {
  const { t } = useTranslation('errors')

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{t('notFound.title')}</CardTitle>
        <CardDescription>{t('notFound.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/">{t('notFound.backToPortfolio')}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
