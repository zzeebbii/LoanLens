import { Link } from '@tanstack/react-router'
import { PlusIcon, WalletIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useLoans } from '@/app/hooks/useLoans'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LoanCard } from '@/features/portfolio/LoanCard'
import { PortfolioTotals } from '@/features/portfolio/PortfolioTotals'

export function PortfolioPage() {
  const { t } = useTranslation()
  const { data: loans, isPending } = useLoans()

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (loans === undefined || loans.length === 0) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CardHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <WalletIcon className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle className="mt-2">{t('empty.noLoans')}</CardTitle>
          <CardDescription>{t('empty.noLoansHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/loans/new">
              <PlusIcon aria-hidden />
              {t('empty.addFirstLoan')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.portfolio')}</h1>
        <Button asChild size="sm">
          <Link to="/loans/new">
            <PlusIcon aria-hidden />
            {t('action.add')}
          </Link>
        </Button>
      </div>

      {/* Only worth showing once there is more than one loan to aggregate. */}
      {loans.length > 1 && <PortfolioTotals loans={loans} />}

      <ul className="grid gap-4 md:grid-cols-2">
        {loans.map((loan) => (
          <li key={loan.id}>
            <LoanCard loan={loan} />
          </li>
        ))}
      </ul>
    </div>
  )
}
