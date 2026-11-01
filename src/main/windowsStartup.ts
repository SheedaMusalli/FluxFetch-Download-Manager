import { app } from 'electron'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { join } from 'node:path'
import { testKnobs } from './testKnobs'

export const WINDOWS_STARTUP_MINIMIZED_ARG = '--fluxfetch-start-minimized'
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const MACHINE_RUN_KEY = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

function registryCommand(
  action: 'query' | 'add' | 'delete',
  key: string,
  extra: string[] = []
): SpawnSyncReturns<string> {
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  return spawnSync(executable, [action, key, ...extra], {
    encoding: 'utf8',
    windowsHide: true
  })
}

function runEntry(key: string): string | null {
  const result = registryCommand('query', key, ['/v', 'FluxFetch'])
  if (result.status !== 0) return null
  const line = result.stdout.split(/\r?\n/).find((value) => /^\s*FluxFetch\s+REG_/i.test(value))
  return line?.replace(/^\s*FluxFetch\s+REG_\w+\s+/i, '').trim() || null
}

function targetsCurrentExecutable(command: string | null): boolean {
  if (!command) return false
  const normalized = (value: string): string => value.replaceAll('/', '\\').toLowerCase()
  return normalized(command).includes(normalized(process.execPath))
}

export function windowsStartupSettingSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged && !testKnobs.userDataDir
}

export function getLaunchWithWindowsMinimized(): boolean {
  if (!windowsStartupSettingSupported()) return false
  // Read the exact Run value we own. Electron's executableWillLaunchAtLogin can report true for
  // another FluxFetch installation (or a stale machine-wide value), which made the controlled
  // settings checkbox snap back after users tried to turn it off.
  return (
    targetsCurrentExecutable(runEntry(RUN_KEY)) ||
    targetsCurrentExecutable(runEntry(MACHINE_RUN_KEY))
  )
}

export function setLaunchWithWindowsMinimized(enabled: boolean): boolean {
  if (!windowsStartupSettingSupported()) return false
  if (enabled) {
    const command = `"${process.execPath}" ${WINDOWS_STARTUP_MINIMIZED_ARG}`
    const result = registryCommand('add', RUN_KEY, [
      '/v',
      'FluxFetch',
      '/t',
      'REG_SZ',
      '/d',
      command,
      '/f'
    ])
    if (result.status !== 0) {
      console.warn('[fluxfetch] could not enable Windows startup', result.stderr || result.stdout)
      return false
    }
  } else {
    // Delete only our per-user entry. A stale all-users entry is managed by the installer and
    // cannot be safely removed by a standard user process.
    const result = registryCommand('delete', RUN_KEY, ['/v', 'FluxFetch', '/f'])
    if (result.status !== 0 && runEntry(RUN_KEY)) {
      console.warn('[fluxfetch] could not disable Windows startup', result.stderr || result.stdout)
      return true
    }
  }
  return getLaunchWithWindowsMinimized()
}
