import { app } from 'electron'
import { testKnobs } from './testKnobs'

export const WINDOWS_STARTUP_MINIMIZED_ARG = '--fluxfetch-start-minimized'

export function windowsStartupSettingSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged && !testKnobs.userDataDir
}

export function getLaunchWithWindowsMinimized(): boolean {
  if (!windowsStartupSettingSupported()) return false
  try {
    return app.getLoginItemSettings({
      path: process.execPath,
      args: [WINDOWS_STARTUP_MINIMIZED_ARG]
    }).openAtLogin
  } catch (error) {
    console.warn('[fluxfetch] could not read Windows startup setting', error)
    return false
  }
}

export function setLaunchWithWindowsMinimized(enabled: boolean): boolean {
  if (!windowsStartupSettingSupported()) return false
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [WINDOWS_STARTUP_MINIMIZED_ARG],
    name: 'FluxFetch'
  })
  return getLaunchWithWindowsMinimized()
}
