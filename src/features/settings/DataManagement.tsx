import type { ImportMode } from '@/persistence'

import { useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, ShieldCheckIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRepository } from '@/app/providers/RepositoryProvider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  applyImport,
  buildExport,
  collectExport,
  exportFilename,
  ImportError,
  parseImportJson,
  serialiseExport,
} from '@/persistence'

/**
 * Export, import and delete.
 *
 * With no backend and no sync, the export file is the user's only backup — so this is a
 * first-class screen, not a hidden maintenance corner.
 *
 * Import defaults to merge. Replace destroys data the file may not contain, so it takes a
 * deliberate selection and a confirmation.
 */
export function DataManagement() {
  const { t } = useTranslation(['settings', 'errors', 'common'] as const)
  const repository = useRepository()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<ImportMode>('MERGE')
  const [status, setStatus] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ message: string; issues: readonly string[] } | null>(
    null,
  )
  const [confirmingClear, setConfirmingClear] = useState(false)

  const handleExport = async () => {
    const file = buildExport(await collectExport(repository))
    const blob = new Blob([serialiseExport(file)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename()
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    setProblem(null)
    setStatus(null)

    try {
      const bundle = parseImportJson(await file.text())
      const result = await applyImport(repository, bundle, mode)

      // Everything on screen was derived from the previous contents of storage.
      await queryClient.invalidateQueries()

      setStatus(
        t('settings:data.importSuccess', {
          loans: t('settings:data.importedLoans', { count: result.loansImported }),
          scenarios: t('settings:data.importedScenarios', { count: result.scenariosImported }),
        }),
      )
    } catch (error) {
      setProblem(
        error instanceof ImportError
          ? { message: error.message, issues: error.issues }
          : { message: t('errors:storage.body'), issues: [] },
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('settings:section.data')}</CardTitle>
        <CardDescription>{t('settings:data.storedLocally')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Alert variant="info">
          <ShieldCheckIcon aria-hidden />
          <AlertDescription>{t('settings:data.onlyRequest')}</AlertDescription>
        </Alert>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('settings:data.export')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings:data.exportHelp')}</p>
          <Button variant="outline" size="sm" onClick={() => void handleExport()}>
            <DownloadIcon aria-hidden />
            {t('settings:data.export')}
          </Button>
        </div>

        <div className="space-y-3 border-t pt-6">
          <h3 className="text-sm font-medium">{t('settings:data.import')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings:data.importHelp')}</p>

          <div className="space-y-1">
            <Label htmlFor="import-mode">{t('settings:data.importMode')}</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
              <SelectTrigger id="import-mode" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MERGE">{t('settings:data.importMerge')}</SelectItem>
                <SelectItem value="REPLACE">{t('settings:data.importReplace')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {mode === 'MERGE'
                ? t('settings:data.importMergeHelp')
                : t('settings:data.importReplaceHelp')}
            </p>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) void handleImport(file)
              // Reset so re-choosing the same file fires a change event again.
              event.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <UploadIcon aria-hidden />
            {t('settings:data.import')}
          </Button>
        </div>

        {status !== null && (
          <Alert variant="info">
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        )}

        {problem !== null && (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>{t('errors:import.title')}</AlertTitle>
            <AlertDescription>
              <p>{problem.message}</p>
              {problem.issues.length > 0 && (
                <>
                  <p className="font-medium">{t('errors:import.issues')}</p>
                  <ul className="list-disc pl-4">
                    {problem.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 border-t pt-6">
          <h3 className="text-sm font-medium">{t('settings:data.clear')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings:data.clearHelp')}</p>
          <Button variant="destructive" size="sm" onClick={() => setConfirmingClear(true)}>
            {t('settings:data.clear')}
          </Button>
        </div>

        <Dialog open={confirmingClear} onOpenChange={setConfirmingClear}>
          <DialogContent closeLabel={t('common:action.close')}>
            <DialogHeader>
              <DialogTitle>{t('settings:data.clear')}</DialogTitle>
              <DialogDescription>{t('settings:data.clearConfirm')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingClear(false)}>
                {t('common:action.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await repository.clear()
                  await queryClient.invalidateQueries()
                  setConfirmingClear(false)
                  setStatus(t('settings:data.cleared'))
                }}
              >
                {t('common:action.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
