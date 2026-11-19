import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { findUpdate, RELEASES_URL } from './releases.js'

const enabled = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AppUpdates')
const AppUpdates = registerPlugin('AppUpdates')
const CHECK_INTERVAL = 12 * 60 * 60 * 1000

export function useUpdates(onboarding) {
  const [version, setVersion] = useState('')
  const [release, setRelease] = useState(null)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const lastCheck = useRef(0)
  const inFlight = useRef(false)

  const check = useCallback(async (manual = false) => {
    const now = Date.now()
    if (!enabled || inFlight.current || (!manual && now - lastCheck.current < CHECK_INTERVAL)) return
    inFlight.current = true
    lastCheck.current = now
    setBusy('checking')
    if (manual) setStatus('')
    try {
      const info = await CapApp.getInfo()
      setVersion(info.version)
      const { status, data } = await CapacitorHttp.get({
        url: RELEASES_URL,
        headers: { Accept: 'application/vnd.github+json' },
        responseType: 'json',
        connectTimeout: 8000,
        readTimeout: 8000,
      })
      if (status !== 200) throw new Error('Release request failed')
      const next = findUpdate(data, info.version)
      setRelease(next)
      setStatus(manual && !next ? 'update.latest' : '')
    } catch {
      if (manual) setStatus('update.checkFailed')
    } finally {
      inFlight.current = false
      setBusy('')
    }
  }, [])

  useEffect(() => {
    if (!enabled || onboarding) return undefined
    void check()
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void check()
    })
    return () => { handle.then(listener => listener.remove()).catch(() => {}) }
  }, [check, onboarding])

  const install = async () => {
    if (!release || inFlight.current) return
    inFlight.current = true
    setStatus('')
    setBusy('downloading')
    try {
      await AppUpdates.install(release)
      setStatus('update.installOpened')
    } catch (error) {
      setStatus(error?.code === 'permission-denied' ? 'update.permission' : 'update.installFailed')
    } finally {
      inFlight.current = false
      setBusy('')
    }
  }

  return { enabled, version, release, busy, status, check, install }
}
