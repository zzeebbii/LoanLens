import type { Loan } from '@/domain/loan'
import type { Scenario } from '@/domain/scenario'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useRepository } from '@/app/providers/RepositoryProvider'

/**
 * Reading and writing loans and scenarios.
 *
 * Query keys are hierarchical so invalidating a loan also invalidates anything derived from
 * it. Deleting a loan removes its scenarios in storage, so the cache has to be told the
 * same thing or the UI keeps showing scenarios for a loan that no longer exists.
 */

export const loanKeys = {
  all: ['loans'] as const,
  detail: (id: string) => ['loans', id] as const,
  scenarios: (loanId: string) => ['loans', loanId, 'scenarios'] as const,
  scenario: (loanId: string, scenarioId: string) =>
    ['loans', loanId, 'scenarios', scenarioId] as const,
}

export function useLoans() {
  const repository = useRepository()
  return useQuery({ queryKey: loanKeys.all, queryFn: () => repository.listLoans() })
}

export function useLoan(id: string | undefined) {
  const repository = useRepository()
  return useQuery({
    queryKey: loanKeys.detail(id ?? ''),
    queryFn: () => repository.getLoan(id as string),
    enabled: id !== undefined,
  })
}

export function useSaveLoan() {
  const repository = useRepository()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (loan: Loan) => repository.saveLoan(loan),
    onSuccess: async (_result, loan) => {
      await queryClient.invalidateQueries({ queryKey: loanKeys.all })
      await queryClient.invalidateQueries({ queryKey: loanKeys.detail(loan.id) })
    },
  })
}

export function useDeleteLoan() {
  const repository = useRepository()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => repository.deleteLoan(id),
    onSuccess: async (_result, id) => {
      // `loans` is a prefix of both the detail and scenario keys, so one invalidation
      // covers the scenarios that were deleted alongside the loan.
      queryClient.removeQueries({ queryKey: loanKeys.detail(id) })
      await queryClient.invalidateQueries({ queryKey: loanKeys.all })
    },
  })
}

export function useScenarios(loanId: string | undefined) {
  const repository = useRepository()
  return useQuery({
    queryKey: loanKeys.scenarios(loanId ?? ''),
    queryFn: () => repository.listScenarios(loanId as string),
    enabled: loanId !== undefined,
  })
}

export function useSaveScenario() {
  const repository = useRepository()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (scenario: Scenario) => repository.saveScenario(scenario),
    onSuccess: async (_result, scenario) => {
      await queryClient.invalidateQueries({ queryKey: loanKeys.scenarios(scenario.loanId) })
    },
  })
}

export function useDeleteScenario(loanId: string) {
  const repository = useRepository()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => repository.deleteScenario(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: loanKeys.scenarios(loanId) })
    },
  })
}
