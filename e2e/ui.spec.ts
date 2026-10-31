import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { BLOCK, expect, interfacesEnv, NETWORKS, test } from './fixtures'
import { IpcChannels } from '../src/shared/ipc-channels'

// G. A handful of journeys through the real UI, to prove the screens are wired to the main
// process. Download correctness is covered far more thoroughly by the API-level specs; these
// only need to show that clicking the buttons drives it.

const SIZE = 24 * BLOCK

/** The destination picker and "Reveal in Finder" go through native OS UI — replace both. */
async function stubNativeUi(
  fluxfetch: import('./fixtures').FluxFetchApp,
  destination: string
): Promise<void> {
  await fluxfetch.evaluateMain(({ dialog, shell }, dest) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dest] })) as never
    const revealed: string[] = []
    ;(globalThis as Record<string, unknown>).__revealed = revealed
    shell.showItemInFolder = (path: string) => void revealed.push(path)
    const opened: string[] = []
    ;(globalThis as Record<string, unknown>).__opened = opened
    shell.openPath = async (path: string) => {
      opened.push(path)
      return ''
    }
  }, destination)
}

async function openAddUrl(page: Page): Promise<void> {
  const addUrl = page.getByRole('button', { name: '+ Add URL', exact: true })
  if (await addUrl.isVisible()) await addUrl.click()
}

test.describe('UI journeys @smoke', () => {
  test('add-download page has a clear route back to download history', async ({ fluxfetch }) => {
    const page = fluxfetch.page
    await page.getByRole('button', { name: '+ Add URL', exact: true }).click()
    const backButton = page.getByRole('button', { name: 'Downloads library' })
    await expect(backButton).toBeVisible()
    await backButton.click()
    await expect(page.getByRole('button', { name: '+ Add URL', exact: true })).toBeVisible()
  })

  test('starts a real Cloudflare speed test only after the user chooses to', async ({
    fluxfetch
  }) => {
    const page = fluxfetch.page
    let requests = 0
    await page.route('https://speed.cloudflare.com/**', async (route) => {
      requests += 1
      await route.abort()
    })

    await page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'FluxFetch internet speed test' })
    ).toBeVisible()
    await expect(dialog.getByText('Ready when you are')).toBeVisible()
    await expect(dialog.getByLabel('Latency result')).toHaveText('—')
    await expect(dialog.getByLabel('Jitter result')).toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText('—')
    await expect(dialog.getByLabel('Upload result')).toHaveText('—')
    expect(requests).toBe(0)

    await dialog.getByRole('button', { name: 'Start test' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect.poll(() => requests).toBeGreaterThan(0)
    await expect(dialog.getByRole('button', { name: 'Run again' })).toBeVisible()
    await expect(dialog.getByLabel('Latency result')).toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText('—')
    await expect(dialog.getByLabel('Upload result')).toHaveText('—')

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })

  test('speed test dialog stays inside a compact window', async ({ fluxfetch }) => {
    await fluxfetch.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(720, 650)
    }, null)

    const page = fluxfetch.page
    await page.getByRole('button', { name: 'Speed test' }).click()

    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'FluxFetch internet speed test' })
    ).toBeVisible()
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width
      }
    })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.width).toBeGreaterThan(600)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    const closeBounds = await dialog.locator('[data-slot="dialog-close"]').boundingBox()
    expect(closeBounds).not.toBeNull()
    if (closeBounds) expect(closeBounds.y).toBeGreaterThanOrEqual(0)
    await expect(dialog.getByLabel('Speed test duration')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start test' })).toBeInViewport()
    for (const label of ['Latency result', 'Jitter result', 'Download result', 'Upload result']) {
      await expect(dialog.getByLabel(label)).toBeVisible()
    }
  })

  test('double-clicking a completed history item opens its file', async ({ fluxfetch, dirs }) => {
    await stubNativeUi(fluxfetch, dirs.dest)
    const filePath = join(dirs.dest, 'finished.zip')
    await writeFile(filePath, 'finished')
    await fluxfetch.page.evaluate((path) => {
      localStorage.setItem(
        'fluxfetch-download-history-v1',
        JSON.stringify([
          {
            id: 'finished-download',
            fileName: 'finished.zip',
            url: 'https://example.com/finished.zip',
            destinationPath: path,
            status: 'completed',
            totalBytes: 8,
            bytesDownloaded: 8,
            startedAt: Date.now() - 1000,
            completedAt: Date.now(),
            peakSpeedBytesPerSec: 3 * 1048576,
            avgSpeedBytesPerSec: 2.5 * 1048576
          }
        ])
      )
    }, filePath)
    await fluxfetch.page.reload()
    await fluxfetch.page.getByRole('row', { name: /finished\.zip/ }).dblclick()
    await expect
      .poll(() =>
        fluxfetch.evaluateMain(() => (globalThis as Record<string, unknown>).__opened, null)
      )
      .toEqual([filePath])
    await expect(
      fluxfetch.page.getByText(/Last download · Peak 3\.0 MB\/s · Avg 2\.5 MB\/s/)
    ).toBeVisible()

    const row = fluxfetch.page.getByRole('row', { name: /finished\.zip/ })
    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Properties' }).click()
    const properties = fluxfetch.page.getByRole('dialog', { name: 'Download properties' })
    await expect(properties.getByRole('button', { name: 'Open file', exact: true })).toBeEnabled()
    await expect(properties.getByRole('button', { name: 'Open file location' })).toBeEnabled()
    await properties.getByRole('button', { name: 'Refresh address' }).click()
    const refresh = fluxfetch.page.getByRole('dialog', { name: 'Refresh download address' })
    await expect(refresh.getByLabel('Download address')).toHaveValue(
      'https://example.com/finished.zip'
    )
    await refresh.getByRole('button', { name: 'Cancel' }).click()
    await expect(properties).toBeHidden()

    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Refresh Download Address' }).click()
    await fluxfetch.page
      .getByRole('dialog', { name: 'Refresh download address' })
      .getByRole('button', { name: 'Continue to download' })
      .click()
    await expect(fluxfetch.page.getByRole('textbox', { name: 'LINK' })).toHaveValue(
      'https://example.com/finished.zip'
    )
  })

  test('batch removal clears selected history entries but keeps files and active downloads', async ({
    fluxfetch,
    dirs
  }) => {
    const firstPath = join(dirs.dest, 'keep-first.zip')
    const secondPath = join(dirs.dest, 'keep-second.zip')
    await writeFile(firstPath, 'first')
    await writeFile(secondPath, 'second')
    await fluxfetch.page.evaluate(
      ([first, second]) => {
        const now = Date.now()
        localStorage.setItem(
          'fluxfetch-download-history-v1',
          JSON.stringify([
            ...[first, second].map((destinationPath, index) => ({
              id: `completed-${index}`,
              fileName: destinationPath.split(/[\\/]/).pop()!,
              url: `https://example.com/${index}.zip`,
              destinationPath,
              status: 'completed',
              totalBytes: 5,
              bytesDownloaded: 5,
              startedAt: now - 1000,
              completedAt: now,
              peakSpeedBytesPerSec: 0,
              avgSpeedBytesPerSec: 0
            })),
            {
              id: 'active-download',
              fileName: 'active.zip',
              url: 'https://example.com/active.zip',
              destinationPath: first,
              status: 'downloading',
              totalBytes: 100,
              bytesDownloaded: 20,
              startedAt: now - 1000,
              peakSpeedBytesPerSec: 0,
              avgSpeedBytesPerSec: 0
            }
          ])
        )
      },
      [firstPath, secondPath]
    )
    await fluxfetch.page.reload()

    const firstSelection = fluxfetch.page.getByLabel('Select keep-first.zip')
    const firstSelectionTarget = await firstSelection.locator('..').boundingBox()
    expect(firstSelectionTarget?.width).toBeGreaterThanOrEqual(32)
    expect(firstSelectionTarget?.height).toBeGreaterThanOrEqual(32)
    const selectAll = fluxfetch.page.getByLabel('Select all removable downloads')
    const selectAllTarget = await selectAll.locator('..').boundingBox()
    expect(selectAllTarget?.width).toBeGreaterThanOrEqual(32)
    expect(selectAllTarget?.height).toBeGreaterThanOrEqual(32)
    await selectAll.check()
    await expect(fluxfetch.page.getByRole('status')).toHaveText('2 selected · Files stay on disk')
    await expect(fluxfetch.page.getByLabel('Select active.zip')).toBeDisabled()
    await fluxfetch.page.getByRole('button', { name: 'Remove from history' }).click()

    await expect(fluxfetch.page.getByRole('row', { name: /keep-first\.zip/ })).toHaveCount(0)
    await expect(fluxfetch.page.getByRole('row', { name: /keep-second\.zip/ })).toHaveCount(0)
    await expect(fluxfetch.page.getByRole('row', { name: /active\.zip/ })).toBeVisible()
    await expect(fluxfetch.page.getByRole('status')).toHaveCount(0)
    await expect(fluxfetch.page.getByRole('row')).toHaveCount(2) // Header plus the active download.
    expect((await stat(firstPath)).size).toBe(5)
    expect((await stat(secondPath)).size).toBe(6)
  })

  test('single history removal asks whether to delete the file too', async ({
    fluxfetch,
    dirs
  }) => {
    const filePath = join(dirs.dest, 'remove-me.zip')
    await writeFile(filePath, 'remove me')
    await fluxfetch.evaluateMain(({ shell }) => {
      const trashed: string[] = []
      ;(globalThis as Record<string, unknown>).__trashed = trashed
      shell.trashItem = async (path: string) => void trashed.push(path)
    }, null)
    await fluxfetch.page.evaluate((path) => {
      localStorage.setItem(
        'fluxfetch-download-history-v1',
        JSON.stringify([
          {
            id: 'remove-me',
            fileName: 'remove-me.zip',
            url: 'https://example.com/remove-me.zip',
            destinationPath: path,
            status: 'completed',
            totalBytes: 9,
            bytesDownloaded: 9,
            startedAt: Date.now() - 1000,
            completedAt: Date.now(),
            peakSpeedBytesPerSec: 0,
            avgSpeedBytesPerSec: 0
          }
        ])
      )
    }, filePath)
    await fluxfetch.page.reload()

    await fluxfetch.page.getByRole('row', { name: /remove-me\.zip/ }).click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Remove from history' }).click()
    const prompt = fluxfetch.page.getByRole('dialog', { name: 'Remove download' })
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Remove from history' })).toBeEnabled()
    await prompt.getByRole('button', { name: 'Delete file & remove' }).click()
    await expect(prompt).toBeHidden()
    await expect(fluxfetch.page.getByRole('row', { name: /remove-me\.zip/ })).toHaveCount(0)
    await expect
      .poll(() =>
        fluxfetch.evaluateMain(() => (globalThis as Record<string, unknown>).__trashed, null)
      )
      .toEqual([filePath])
  })

  test('missing archive in history shows a helpful message instead of an IPC error', async ({
    fluxfetch,
    dirs
  }) => {
    const missingFile = join(dirs.dest, 'missing-archive.zip')
    await fluxfetch.page.evaluate((path) => {
      localStorage.setItem(
        'fluxfetch-download-history-v1',
        JSON.stringify([
          {
            id: 'missing-archive',
            fileName: 'missing-archive.zip',
            url: 'https://example.com/missing-archive.zip',
            destinationPath: path,
            status: 'completed',
            totalBytes: 1024,
            bytesDownloaded: 1024,
            startedAt: Date.now() - 1000,
            completedAt: Date.now(),
            peakSpeedBytesPerSec: 0,
            avgSpeedBytesPerSec: 0
          }
        ])
      )
    }, missingFile)
    await fluxfetch.page.reload()
    const row = fluxfetch.page.getByRole('row', { name: /missing-archive\.zip/ })
    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Preview archive' }).click()
    const error = fluxfetch.page.getByRole('alert')
    await expect(error).toContainText('no longer at its saved location')
    await expect(error).not.toContainText('Error invoking remote method')
  })

  test('lets users select combined networks in the speed test', async ({ fluxfetch }) => {
    await fluxfetch.page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = fluxfetch.page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'FluxFetch internet speed test' })
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Internet' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await dialog.getByRole('button', { name: 'Combined networks' }).click()
    await expect(
      dialog.getByRole('heading', { name: 'FluxFetch combined network speed test' })
    ).toBeVisible()
    const networkGroup = dialog.getByLabel('Networks to test')
    await expect(networkGroup.getByText(/\d+ selected/)).toBeVisible()
    await expect(networkGroup.getByRole('checkbox').first()).toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Internet' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('shows measured speed results after download and upload samples complete', async ({
    fluxfetch
  }) => {
    test.setTimeout(60_000)
    let inFlight = 0
    let maxInFlight = 0
    let downloadRequests = 0
    let uploadRequests = 0
    await fluxfetch.page.route('https://speed.cloudflare.com/**', async (route) => {
      const bytes = Number(new URL(route.request().url()).searchParams.get('bytes') ?? 0)
      if (bytes > 100_000) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (route.request().method() === 'GET') downloadRequests += 1
        else uploadRequests += 1
      }
      await new Promise((resolve) => setTimeout(resolve, bytes > 100_000 ? 1_050 : 40))
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
          'access-control-allow-origin': '*',
          'timing-allow-origin': '*',
          'access-control-expose-headers': 'Server-Timing',
          'server-timing': 'cfRequestDuration;dur=10'
        },
        body: route.request().method() === 'GET' ? Buffer.alloc(bytes) : ''
      })
      if (bytes > 100_000) inFlight -= 1
    })
    const page = fluxfetch.page
    await page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = page.getByRole('dialog')
    const duration = dialog.getByLabel('Speed test duration')
    await expect(duration).toHaveValue('20')
    await duration.selectOption('10')
    await expect(dialog.getByText('Split evenly between download and upload')).toBeVisible()
    await dialog.getByRole('button', { name: 'Start test' }).click()
    await expect(duration).toBeDisabled()
    await expect(dialog.getByText('Test complete')).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByLabel('Latency result')).toHaveText(/\d+ ms|<1 ms/)
    await expect(dialog.getByLabel('Jitter result')).not.toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText(/\d+(\.\d+)? Mbps|\d+\.\d+ Gbps/)
    await expect(dialog.getByLabel('Upload result')).toHaveText(/\d+(\.\d+)? Mbps|\d+\.\d+ Gbps/)
    expect(maxInFlight).toBeGreaterThanOrEqual(4)
    expect(downloadRequests).toBeGreaterThanOrEqual(17)
    expect(uploadRequests).toBeGreaterThanOrEqual(17)
  })

  test('schedule a linear batch and cancel one queued link', async ({ fluxfetch }) => {
    const encryptionAvailable = await fluxfetch.evaluateMain(
      ({ safeStorage }) => safeStorage.isEncryptionAvailable(),
      null
    )
    test.skip(
      !encryptionAvailable,
      'This runner has no OS credential store for encrypted queue data'
    )

    const page = fluxfetch.page
    await page.getByRole('button', { name: /^Open download queue/ }).click()
    await expect(page.getByRole('heading', { name: 'Schedule and batch downloads' })).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Download links' })
      .fill('https://example.com/alpha.zip\nhttps://example.com/beta.zip')
    await page.locator('input[type="datetime-local"]').fill('2099-01-01T12:00')
    await page.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.getByText('Waiting (2)')).toBeVisible()
    await expect(page.getByText('alpha.zip')).toBeVisible()
    const cancel = page.getByRole('button', { name: 'Cancel alpha.zip' })
    const cancelBounds = await cancel.boundingBox()
    expect(cancelBounds?.width).toBeGreaterThanOrEqual(32)
    expect(cancelBounds?.height).toBeGreaterThanOrEqual(32)
    await cancel.click()
    await expect(page.getByText('Waiting (1)')).toBeVisible()
    await expect(page.getByText('beta.zip')).toBeVisible()
  })

  test('queue preview skips repeated links and links already waiting', async ({ fluxfetch }) => {
    const page = fluxfetch.page
    await page.getByRole('button', { name: /^Open download queue/ }).click()
    await page
      .getByRole('textbox', { name: 'Download links' })
      .fill(
        'https://example.com/repeat.zip\nhttps://EXAMPLE.com/repeat.zip\nhttps://example.com/other.zip'
      )
    await page.locator('input[type="datetime-local"]').fill('2099-01-01T12:00')
    await expect(page.getByText(/3 pasted · 2 new · 1 duplicates skipped/)).toBeVisible()
    await page.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.getByRole('status')).toHaveText('Added 2 links. Skipped 1 duplicate link.')
    await expect(page.getByText('Waiting (2)')).toBeVisible()
    await expect(page.getByText('repeat.zip')).toHaveCount(1)
    await expect(page.getByText('other.zip')).toHaveCount(1)

    await page
      .getByRole('textbox', { name: 'Download links' })
      .fill('https://example.com/repeat.zip\nhttps://example.com/third.zip')
    await page.locator('input[type="datetime-local"]').fill('2099-01-01T12:00')
    await expect(page.getByText(/2 pasted · 1 new · 1 duplicates skipped/)).toBeVisible()
    await page.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.getByRole('status')).toHaveText('Added 1 link. Skipped 1 duplicate link.')
    await expect(page.getByText('Waiting (3)')).toBeVisible()
    await expect(page.getByText('third.zip')).toHaveCount(1)
  })

  test('queue actions stay visible in a short window', async ({ fluxfetch }) => {
    await fluxfetch.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(500, 420)
    }, null)
    const page = fluxfetch.page
    await page.getByRole('button', { name: /^Open download queue/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Schedule and batch downloads' })
    ).toBeVisible()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true }).first()
    ).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Add to queue' })).toBeInViewport()
  })

  test('paste a link, start, pause, resume, finish, reveal the file', async ({
    fluxfetch,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(fluxfetch, dirs.dest)
    const page = fluxfetch.page

    await openAddUrl(page)
    await page.getByRole('button', { name: 'Browse…' }).click()
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())
    const start = page.getByRole('button', { name: 'Start' })
    await expect(start).toBeEnabled()

    const reached = origin.hold(6 * BLOCK)
    await fluxfetch.expectNextDownload(origin.sha256)
    const progressWindowPromise = fluxfetch.electronApp.waitForEvent('window')
    await start.click()
    await reached
    const progressPage = await progressWindowPromise
    await progressPage.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: '+ Add URL' })).toBeVisible()
    await expect(progressPage.getByRole('button', { name: 'Pause' })).toBeVisible()

    await progressPage.getByRole('button', { name: 'Pause' }).click()
    await expect(progressPage.getByRole('button', { name: 'Resume' })).toBeVisible()
    origin.release()
    await progressPage.getByRole('button', { name: 'Resume' }).click()

    const reveal = progressPage.getByRole('button', { name: /Reveal in Finder|Show in folder/ })
    await expect(reveal).toBeVisible()
    const progressWindowClosed = progressPage.waitForEvent('close')
    await reveal.evaluate((button: HTMLButtonElement) => button.click())
    await progressWindowClosed
    const { destinationPath } = (await fluxfetch.current())!
    await expect
      .poll(() =>
        fluxfetch.evaluateMain(() => (globalThis as Record<string, unknown>).__revealed, null)
      )
      .toEqual([destinationPath])
  })

  test('cancel through the confirmation dialog, then "Download Again"', async ({
    fluxfetch,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(fluxfetch, dirs.dest)
    const page = fluxfetch.page
    await openAddUrl(page)
    await page.getByRole('button', { name: 'Browse…' }).click()
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())

    const reached = origin.hold(6 * BLOCK)
    const progressWindowPromise = fluxfetch.electronApp.waitForEvent('window')
    await page.getByRole('button', { name: 'Start' }).click()
    await reached
    const progressPage = await progressWindowPromise
    await progressPage.waitForLoadState('domcontentloaded')
    await progressPage.getByRole('button', { name: 'Cancel', exact: true }).click()
    const alert = progressPage.getByRole('alertdialog')
    const alertBounds = await alert.boundingBox()
    const viewport = await progressPage.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(alertBounds).not.toBeNull()
    if (alertBounds) {
      expect(alertBounds.x).toBeGreaterThanOrEqual(0)
      expect(alertBounds.y).toBeGreaterThanOrEqual(0)
      expect(alertBounds.x + alertBounds.width).toBeLessThanOrEqual(viewport.width)
      expect(alertBounds.y + alertBounds.height).toBeLessThanOrEqual(viewport.height)
    }
    await progressPage.getByRole('button', { name: 'Cancel download' }).click()
    origin.release()

    await progressPage.getByRole('button', { name: 'Download Again' }).click()
    await fluxfetch.expectNextDownload(origin.sha256)
    const retryWindowPromise = fluxfetch.electronApp.waitForEvent('window')
    await page.getByRole('button', { name: 'Start' }).click({ timeout: 5000 })
    const retryPage = await retryWindowPromise
    await expect(
      retryPage.getByRole('button', { name: /Reveal in Finder|Show in folder/ })
    ).toBeVisible()
  })

  test('a link the server rejects shows the error and keeps Start disabled', async ({
    fluxfetch,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(() => ({ status: 404 }))
    const page = fluxfetch.page
    await openAddUrl(page)
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())
    await expect(page.getByText(/could not be found/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  test('a completed download is shown again after a restart', async ({ fluxfetch, serve }) => {
    const origin = await serve({ size: SIZE })
    await fluxfetch.start(origin.url(), origin.sha256)
    await fluxfetch.waitForStatus('completed')
    await fluxfetch.relaunch()
    await expect(fluxfetch.page.getByRole('row', { name: /test\.bin/ })).toBeVisible()
  })

  test('keeps each download in its own progress window', async ({ fluxfetch, serve }) => {
    const first = await serve({ size: SIZE })
    const firstWindowPromise = fluxfetch.electronApp.waitForEvent('window')
    await fluxfetch.start(first.url(), first.sha256)
    const firstWindow = await firstWindowPromise
    await firstWindow.waitForLoadState('domcontentloaded')
    await fluxfetch.waitForStatus('completed')
    await expect(firstWindow.getByRole('button', { name: 'New Download' })).toBeVisible()

    const second = await serve({ size: SIZE })
    const secondReached = second.hold(6 * BLOCK)
    const secondWindowPromise = fluxfetch.electronApp.waitForEvent('window')
    await fluxfetch.start(second.url(), second.sha256)
    await secondReached
    const secondWindow = await secondWindowPromise
    await secondWindow.waitForLoadState('domcontentloaded')
    await expect(secondWindow.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(secondWindow.getByLabel('After all queued downloads finish')).toHaveValue('none')
    await expect(firstWindow.getByRole('button', { name: 'New Download' })).toBeVisible()
    await expect(fluxfetch.page.getByRole('button', { name: '+ Add URL' })).toBeVisible()
  })

  test('history links can be copied from the row menu', async ({ fluxfetch }) => {
    const sourceUrl = 'https://example.com/archive.zip?token=fixture'
    const filePath = 'C:\\FluxFetch-test\\archive.zip'
    await fluxfetch.page.evaluate(
      ({ sourceUrl, filePath }) => {
        localStorage.setItem(
          'fluxfetch-download-history-v1',
          JSON.stringify([
            {
              id: 'copy-fixture',
              fileName: 'archive.zip',
              url: sourceUrl,
              destinationPath: filePath,
              status: 'completed',
              totalBytes: 12,
              bytesDownloaded: 12,
              startedAt: Date.now() - 1000,
              completedAt: Date.now(),
              peakSpeedBytesPerSec: 0,
              avgSpeedBytesPerSec: 0
            }
          ])
        )
      },
      { sourceUrl, filePath }
    )
    await fluxfetch.page.reload()
    await fluxfetch.page.evaluate(() => {
      const clipboard = { text: '' }
      ;(window as Window & { __testClipboard?: { text: string } }).__testClipboard = clipboard
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => (clipboard.text = text) }
      })
    })
    const row = fluxfetch.page.locator('tbody tr[data-download-id="copy-fixture"]')
    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Copy file name' }).click()
    await expect(fluxfetch.page.getByRole('status')).toHaveText('File name copied to clipboard.')
    expect(
      await fluxfetch.page.evaluate(
        () => (window as Window & { __testClipboard?: { text: string } }).__testClipboard?.text
      )
    ).toBe('archive.zip')

    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Copy download URL' }).click()
    await expect(fluxfetch.page.getByRole('status')).toHaveText('Download URL copied to clipboard.')
    expect(
      await fluxfetch.page.evaluate(
        () => (window as Window & { __testClipboard?: { text: string } }).__testClipboard?.text
      )
    ).toBe(sourceUrl)

    await row.click({ button: 'right' })
    await fluxfetch.page.getByRole('menuitem', { name: 'Copy file path' }).click()
    await expect(fluxfetch.page.getByRole('status')).toHaveText('File path copied to clipboard.')
    expect(
      await fluxfetch.page.evaluate(
        () => (window as Window & { __testClipboard?: { text: string } }).__testClipboard?.text
      )
    ).toBe(filePath)
  })

  test('history search and keyboard shortcuts work; download columns can be sorted', async ({
    fluxfetch
  }) => {
    await fluxfetch.page.evaluate(() => {
      const now = Date.now()
      localStorage.setItem(
        'fluxfetch-download-history-v1',
        JSON.stringify(
          [
            {
              id: 'zeta',
              fileName: 'zeta10.zip',
              totalBytes: 20,
              bytesDownloaded: 10,
              speedBytesPerSec: 5,
              status: 'paused',
              startedAt: now - 1000
            },
            {
              id: 'alpha',
              fileName: 'Alpha2.bin',
              totalBytes: 10,
              bytesDownloaded: 10,
              speedBytesPerSec: 10,
              status: 'completed',
              startedAt: now
            }
          ].map((entry) => ({
            url: `https://example.com/${entry.id}`,
            destinationPath: '',
            completedAt: entry.startedAt + 500,
            peakSpeedBytesPerSec: 0,
            avgSpeedBytesPerSec: 0,
            ...entry
          }))
        )
      )
    })
    await fluxfetch.page.reload()
    const page = fluxfetch.page
    const search = page.getByRole('textbox', { name: 'Search downloads' })
    await page.keyboard.press('Control+f')
    await expect(search).toBeFocused()
    await search.fill('example.com/alpha')
    await expect(page.locator('tbody tr[data-download-id]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.locator('tbody tr[data-download-id]')).toHaveCount(2)
    await search.fill('alpha')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(search).toBeFocused()
    await expect(page.locator('tbody tr[data-download-id]')).toHaveCount(2)

    const rows = page.locator('tbody tr[data-download-id]')
    const fileName = async (index: number): Promise<string> =>
      (await rows.nth(index).locator('td').nth(1).locator('span.truncate').innerText()).trim()
    const sort = (column: string): ReturnType<typeof page.getByRole> =>
      page.getByRole('button', { name: new RegExp(`Sort by ${column}`) })
    await sort('File name').click()
    await expect.poll(() => fileName(0)).toBe('Alpha2.bin')
    await sort('File name').click()
    await expect.poll(() => fileName(0)).toBe('zeta10.zip')
    await sort('Type').click()
    await expect.poll(() => fileName(0)).toBe('Alpha2.bin')
    await sort('Status').click()
    await expect.poll(() => fileName(0)).toBe('Alpha2.bin')
    await sort('Progress').click()
    await expect.poll(() => fileName(0)).toBe('zeta10.zip')
    await sort('Speed').click()
    await expect.poll(() => fileName(0)).toBe('zeta10.zip')

    await search.blur()
    await page.keyboard.press('Control+n')
    await expect(page.getByRole('button', { name: 'Downloads library' })).toBeVisible()
    await page.getByRole('button', { name: 'Downloads library' }).click()
    await page.keyboard.press('Control+Shift+q')
    await expect(page.getByRole('heading', { name: 'Schedule and batch downloads' })).toBeVisible()
    await page.locator('[data-slot="dialog-close"]').click()
  })

  test('library preferences, bulk actions and CSV export work together', async ({ fluxfetch }) => {
    const page = fluxfetch.page
    await page.evaluate(() => {
      const now = Date.now()
      localStorage.setItem(
        'fluxfetch-download-history-v1',
        JSON.stringify(
          [
            {
              id: 'zeta-bulk',
              fileName: 'zeta10.zip',
              totalBytes: 20,
              bytesDownloaded: 20,
              status: 'completed',
              startedAt: now - 2000,
              completedAt: now - 1000,
              destinationPath: 'C:\\Bulk\\zeta10.zip',
              url: 'https://example.com/zeta10.zip'
            },
            {
              id: 'alpha-bulk',
              fileName: 'Alpha2.bin',
              totalBytes: 10,
              bytesDownloaded: 10,
              status: 'error',
              startedAt: now - 1000,
              destinationPath: 'C:\\Bulk\\Alpha2.bin',
              url: 'https://example.com/alpha2.bin'
            }
          ].map((entry) => ({
            peakSpeedBytesPerSec: 0,
            avgSpeedBytesPerSec: 0,
            ...entry
          }))
        )
      )
    })
    await page.reload()

    await page.getByRole('button', { name: 'Failed', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Failed', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.reload()
    await expect(page.locator('tbody tr[data-download-id]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Failed', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await page.getByRole('button', { name: 'All downloads', exact: true }).click()
    const sortName = page.getByRole('button', { name: /Sort by File name/ })
    await sortName.click()
    await sortName.click()
    await page.reload()
    const rows = page.locator('tbody tr[data-download-id]')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toHaveAttribute('data-download-id', 'zeta-bulk')
    await expect(page.getByRole('columnheader', { name: /File name/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    await expect(page.getByText('Showing 2 of 2')).toBeVisible()

    const search = page.getByRole('textbox', { name: 'Search downloads' })
    await search.fill('does-not-match')
    await expect(page.getByText('Showing 0 of 2')).toBeVisible()
    await expect(page.getByText('No matching downloads')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search and filters' }).click()
    await expect(rows).toHaveCount(2)

    await page.evaluate(() => {
      const clipboard = { text: '' }
      ;(window as Window & { __bulkClipboard?: { text: string } }).__bulkClipboard = clipboard
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => (clipboard.text = text) }
      })
    })
    await search.blur()
    await page.keyboard.press('Control+a')
    await expect(page.getByRole('status')).toHaveText('2 selected · Files stay on disk')
    const clipboard = (): Promise<string | undefined> =>
      page.evaluate(
        () => (window as Window & { __bulkClipboard?: { text: string } }).__bulkClipboard?.text
      )
    await page.getByRole('button', { name: 'Names' }).click()
    expect(await clipboard()).toContain('Alpha2.bin')
    expect(await clipboard()).toContain('zeta10.zip')
    await page.getByRole('button', { name: 'URLs' }).click()
    expect(await clipboard()).toContain('https://example.com/alpha2.bin')
    await page.getByRole('button', { name: 'Paths' }).click()
    expect(await clipboard()).toContain('C:\\Bulk\\zeta10.zip')
    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.getByRole('button', { name: 'Names' })).toHaveCount(0)

    await page.evaluate(() => {
      type ExportWindow = Window & { __csvText?: Promise<string>; __csvName?: string }
      const target = window as ExportWindow
      URL.createObjectURL = ((blob: Blob) => {
        target.__csvText = blob.text()
        return 'blob:fluxfetch-e2e-export'
      }) as typeof URL.createObjectURL
      HTMLAnchorElement.prototype.click = function () {
        target.__csvName = this.download
      }
    })
    await page.getByRole('button', { name: 'Export visible downloads as CSV' }).click()
    await expect(page.getByRole('status')).toHaveText('Exported 2 visible downloads.')
    const exported = await page.evaluate(async () => {
      const target = window as Window & { __csvText?: Promise<string>; __csvName?: string }
      return { csv: await target.__csvText, name: target.__csvName }
    })
    expect(exported.name).toMatch(/^fluxfetch-downloads-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = exported.csv ?? ''
    expect(csv).toContain('"File name","URL","File path"')
    expect(csv).toContain('"Alpha2.bin","https://example.com/alpha2.bin"')
  })
})

// What a user sets is still set after they reload or restart — checked only through what they see.
test.describe('settings @smoke', () => {
  test('settings stays inside a short window and scrolls to its last option', async ({
    fluxfetch
  }) => {
    await fluxfetch.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(700, 480)
    }, null)
    const page = fluxfetch.page
    const settings = page.getByRole('button', { name: 'Settings' })
    const settingsBounds = await settings.boundingBox()
    expect(settingsBounds?.width).toBeGreaterThanOrEqual(32)
    expect(settingsBounds?.height).toBeGreaterThanOrEqual(32)
    const themeToggle = page.getByRole('button', { name: /^Switch to (dark|light) theme$/ })
    const themeBounds = await themeToggle.boundingBox()
    expect(themeBounds?.width).toBeGreaterThanOrEqual(32)
    expect(themeBounds?.height).toBeGreaterThanOrEqual(32)
    await settings.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'FluxFetch settings' })).toBeVisible()
    await expect(dialog.getByLabel('After all queued downloads finish')).toHaveCount(0)
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.right - bounds.left).toBeGreaterThan(600)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    const checkNow = dialog.getByRole('button', { name: 'Check now' })
    await checkNow.scrollIntoViewIfNeeded()
    await expect(checkNow).toBeInViewport()
  })

  test('settings close button responds across the center of its hit target', async ({
    fluxfetch
  }) => {
    const page = fluxfetch.page
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog')
    const close = dialog.getByRole('button', { name: 'Close' })
    const bounds = await close.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBe(40)
    expect(bounds!.height).toBe(40)
    const iconBounds = await close.locator('svg').boundingBox()
    expect(iconBounds).not.toBeNull()
    const iconX = iconBounds!.x + iconBounds!.width / 2
    const iconY = iconBounds!.y + iconBounds!.height / 2
    expect(iconBounds!.x).toBeGreaterThanOrEqual(bounds!.x)
    expect(iconBounds!.y).toBeGreaterThanOrEqual(bounds!.y)
    expect(iconBounds!.x + iconBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
    expect(iconBounds!.y + iconBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
    await page.mouse.move(bounds!.x - 4, bounds!.y - 4)
    const baseBackground = await close.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    for (const [x, y] of [
      [iconBounds!.x + 1, iconBounds!.y + 1],
      [iconX, iconY],
      [iconBounds!.x + iconBounds!.width - 1, iconBounds!.y + iconBounds!.height - 1]
    ]) {
      await page.mouse.move(x, y)
      await expect.poll(() => close.evaluate((element) => element.matches(':hover'))).toBe(true)
    }
    const hoverBackground = await close.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    expect(hoverBackground).not.toBe(baseBackground)
    expect(
      await close.evaluate(
        (button, { x, y }) => {
          const hit = document.elementFromPoint(x, y)
          return hit === button || button.contains(hit)
        },
        { x: iconX, y: iconY }
      )
    ).toBe(true)
    await page.mouse.click(iconX, iconY)
    await expect(dialog).not.toBeVisible()
  })

  test('OmniLink button explains its Windows launch and network behavior', async ({
    fluxfetch
  }) => {
    test.skip(
      (await fluxfetch.page.evaluate(() => window.fluxfetch.platform)) !== 'win32',
      'OmniLink is a Windows-only integration'
    )
    // E2E builds do not include the optional OmniLink binary. Stub its availability so this
    // test checks the button and help text without depending on release-only assets.
    await fluxfetch.evaluateMain(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.isOmniLinkInstalled)
      ipcMain.handle(channels.isOmniLinkInstalled, () => true)
    }, IpcChannels)
    await fluxfetch.page.reload()
    const button = fluxfetch.page.getByRole('button', { name: 'Run OmniLink' })
    await expect(button).toBeVisible()
    await button.hover()
    const tooltip = fluxfetch.page.locator('[data-slot="tooltip-content"]')
    await expect(tooltip).toContainText("Use OmniLink's tray menu")
    await expect(tooltip).toContainText('Steam')
    await expect(tooltip).toContainText('download servers')
  })

  test.describe('with an update available', () => {
    test.use({ appEnv: { FLUXFETCH_FORCE_UPDATE_VERSION: '9.9.9' } })

    test('every choice survives a reload and a restart, even made right before', async ({
      fluxfetch,
      dirs
    }) => {
      const page = (): Page => fluxfetch.page
      const homeDir = await fluxfetch.evaluateMain(({ app }) => app.getPath('home'), null)
      const displayedDestination = dirs.dest.startsWith(homeDir)
        ? `~${dirs.dest.slice(homeDir.length)}`
        : dirs.dest
      await page().getByRole('button', { name: 'Not now' }).click()

      const themeToggle = page().getByRole('button', { name: /^Switch to (dark|light) theme$/ })
      const themeBounds = await themeToggle.boundingBox()
      expect(themeBounds?.width).toBeGreaterThanOrEqual(32)
      expect(themeBounds?.height).toBeGreaterThanOrEqual(32)
      // After switching, the toggle offers to switch back.
      const labelAfterSwitch = (await themeToggle.getAttribute('aria-label'))!.includes('dark')
        ? 'Switch to light theme'
        : 'Switch to dark theme'
      await themeToggle.click()

      await stubNativeUi(fluxfetch, dirs.dest)
      await openAddUrl(page())
      await page().getByRole('button', { name: 'Browse…' }).click()

      const editNetwork = page().getByRole('button', { name: 'Edit network' }).first()
      const editBounds = await editNetwork.boundingBox()
      expect(editBounds?.width).toBeGreaterThanOrEqual(32)
      expect(editBounds?.height).toBeGreaterThanOrEqual(32)
      await editNetwork.click()
      await page().getByRole('textbox', { name: 'Name' }).fill('Office fibre')
      await page().getByRole('button', { name: 'Violet' }).click()
      await page().getByRole('button', { name: 'Done' }).click()

      const expectAllKept = async (): Promise<void> => {
        // Waiting on the titlebar indicator first means the update check has answered, so the
        // dialog's absence below is a real "stayed dismissed", not "not checked yet".
        await expect(page().getByRole('link', { name: 'Update available: 9.9.9' })).toBeVisible()
        await expect(page().getByRole('alertdialog')).toBeHidden()
        await openAddUrl(page())
        await expect(page().getByRole('button', { name: labelAfterSwitch })).toBeVisible()
        await expect(page().getByText('TO', { exact: true }).locator('..')).toContainText(
          displayedDestination
        )
        await expect(page().getByText('Office fibre')).toBeVisible()
        await page().getByRole('button', { name: 'Edit network' }).first().click()
        await expect(page().getByRole('button', { name: 'Violet' })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await page().keyboard.press('Escape')
      }

      // No waiting for saves: a user doesn't either.
      await page().reload()
      await expectAllKept()
      await fluxfetch.relaunch()
      await expectAllKept()
    })
  })

  test('a broken settings file falls back to what a fresh install shows', async ({
    fluxfetch,
    dirs
  }) => {
    const settingsPath = join(dirs.userData, 'app-settings.json')
    // The TO row, as the user sees it — compared whole, so no platform's idea of the default
    // folder is baked into the test.
    const choices = (): Promise<string> =>
      fluxfetch.page.getByText('TO', { exact: true }).locator('..').innerText()
    await openAddUrl(fluxfetch.page)
    const fresh = await choices()

    await fluxfetch.quit()
    await writeFile(settingsPath, '{"destinationDir": "/')
    await fluxfetch.launch()
    await openAddUrl(fluxfetch.page)
    expect(await choices()).toEqual(fresh)

    await fluxfetch.quit()
    await writeFile(settingsPath, JSON.stringify({ destinationDir: join(dirs.dest, 'unplugged') }))
    await fluxfetch.launch()
    await openAddUrl(fluxfetch.page)
    expect(await choices()).toEqual(fresh)
  })
})

test.describe('no networks', () => {
  test.use({ appEnv: { FLUXFETCH_E2E_INTERFACES: '' } })

  test('a network appearing takes you back to the start screen @smoke', async ({ fluxfetch }) => {
    await openAddUrl(fluxfetch.page)
    await expect(fluxfetch.page.getByText('No networks to combine')).toBeVisible()
    await fluxfetch.evaluateMain(
      (_electron, value) => {
        process.env['FLUXFETCH_E2E_INTERFACES'] = value
      },
      interfacesEnv({ a: NETWORKS['a'] })
    )
    // The network monitor polls independently and pushes newly available interfaces to the UI.
    // Waiting for the start screen avoids racing that update against a click on the disappearing
    // no-networks screen.
    await expect(fluxfetch.page.getByRole('textbox', { name: 'LINK' })).toBeVisible()
  })
})
