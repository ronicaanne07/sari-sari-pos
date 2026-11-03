import { useEffect, useRef, useState } from 'react'
import { createDetector } from '../lib/scanner'
import { Sheet, btn, inputCls } from '../ui'

function cameraMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow the camera for this site in your browser settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.'
  return 'The camera could not be started.'
}

/**
 * Camera barcode scanner in a bottom sheet.
 *  continuous: keep scanning after each code (Sell). Otherwise it stops after the first code.
 * The same code is ignored for 2 seconds so one item is not added five times while you hold it up.
 * A box to type the code is always shown, for dim shops, damaged labels, or a denied camera.
 */
export function Scanner({
  title,
  hint,
  continuous = false,
  onDetect,
  onClose,
}: {
  title: string
  hint?: string
  continuous?: boolean
  onDetect: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  const [state, setState] = useState<'starting' | 'scanning'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState<boolean | null>(null) // null = no torch on this camera
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let stream: MediaStream | null = null

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('The camera only works on a secure (https) page. You can type the code below instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (e) {
        if (!stopped) setError(cameraMessage(e))
        return
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const video = videoRef.current!
      video.srcObject = stream
      await video.play().catch(() => {})

      const track = stream.getVideoTracks()[0]
      trackRef.current = track
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean }
      if (caps.torch) setTorchOn(false)

      let detector
      try {
        detector = await createDetector()
      } catch {
        if (!stopped) setError('The barcode reader could not be loaded. You can type the code below.')
        return
      }
      if (stopped) return
      setState('scanning')

      let last = ''
      let lastAt = 0
      const tick = async () => {
        if (stopped) return
        try {
          const code = await detector.detect(video)
          if (code && !(code === last && Date.now() - lastAt < 2000)) {
            last = code
            lastAt = Date.now()
            navigator.vibrate?.(60)
            onDetectRef.current(code)
            if (!continuous) return
          }
        } catch (e) {
          console.error(e)
        }
        timer = setTimeout(tick, 150)
      }
      void tick()
    }

    void start()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [continuous])

  async function toggleTorch() {
    const next = !torchOn
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      /* torch not controllable: leave the button as it was */
    }
  }

  function submitTyped() {
    const code = typed.trim()
    if (!code) return
    onDetect(code)
    setTyped('')
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} onClick={onClose}>
          {continuous ? 'Done' : 'Cancel'}
        </button>
      }
    >
      <div className="space-y-3">
        {error ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" aria-label="Camera view" />
            <div className="pointer-events-none absolute inset-x-[12%] inset-y-[30%] rounded-lg border-2 border-white/90 ring-1 ring-black/50" />
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <span className="rounded-full bg-black/65 px-3 py-1 text-sm font-medium text-white">
                {state === 'starting' ? 'Starting camera…' : (hint ?? 'Point at the barcode')}
              </span>
            </div>
            {torchOn !== null && (
              <button
                onClick={toggleTorch}
                aria-label="Toggle flashlight"
                className="absolute right-2 top-2 rounded-full bg-black/50 px-3 py-1.5 text-sm text-white"
              >
                {torchOn ? '🔦 On' : '🔦 Off'}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
            placeholder="Or type the barcode"
            inputMode="numeric"
            className={inputCls}
            aria-label="Type barcode"
          />
          <button className={btn.secondary} disabled={!typed.trim()} onClick={submitTyped}>
            OK
          </button>
        </div>
      </div>
    </Sheet>
  )
}
