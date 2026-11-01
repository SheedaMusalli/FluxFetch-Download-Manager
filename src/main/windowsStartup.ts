import { app } from 'electron'
import { testKnobs } from './testKnobs'

export const WINDOWS_STARTUP_MINIMIZED_ARG = '--fluxfetch-start-minimized'

export function windowsStartupSettingSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged && !testKnobs.userDataDir
}

export function getLaunchWithWindowsMinimized(): boolean {
  if (!windowsStartupSettingSupported()) return false
  try {
    const settings = app.getLoginItemSettings({
      path: process.execPath,
      args: [WINDOWS_STARTUP_MINIMIZED_ARG]
    })
    // The installer historically registered FluxFetch at sign-in without command-line args.
    // Treat that existing Run entry as enabled too; installer upgrades now add the minimized
    // argument so future sign-ins go straight to the tray.
    return settings.openAtLogin || settings.executableWillLaunchAtLogin
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
