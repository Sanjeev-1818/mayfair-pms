import { useEffect, useRef, useState } from 'react';
import { readQr } from '../lib/qr.js';
import { fileToImage } from '../lib/image.js';

// Live camera QR scanner with an "upload a photo or screenshot" fallback.
export default function Scanner({ onResult, hint = 'Hold the QR code inside the frame', wide = false, uploadLabel = 'Upload a photo or screenshot instead' }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function tick() {
      if (stopped || done.current) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        // Scan the central area at good resolution: the Aadhaar QR is very dense.
        const side = Math.min(v.videoWidth, v.videoHeight) * 0.9;
        const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
        const size = Math.min(1200, Math.round(side));
        canvas.width = size; canvas.height = size;
        ctx.drawImage(v, sx, sy, side, side, 0, 0, size, size);
        try {
          const text = await readQr(ctx.getImageData(0, 0, size, size));
          if (text && !done.current) {
            done.current = true;
            navigator.vibrate?.(60);
            cb.current(text);
            return;
          }
        } catch { /* keep scanning */ }
      }
      timer = setTimeout(tick, 120);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        track.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        tick();
      } catch {
        setError('Camera is not available. Please allow camera access, or upload a photo below.');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      let text = await readQr(file);
      if (!text) {
        // Large phone photos: try a downscaled copy too.
        const img = await fileToImage(file);
        const c = document.createElement('canvas');
        const s = Math.min(1, 1600 / Math.max(img.width, img.height));
        c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        text = await readQr(c.getContext('2d').getImageData(0, 0, c.width, c.height));
      }
      if (text) { done.current = true; cb.current(text); } else setError('No QR code found in that image. Try a sharper photo with the whole QR visible.');
    } catch {
      setError('Could not read that image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className={`camera${wide ? ' wide' : ''}`}>
        <video ref={video} playsInline muted autoPlay />
        <div className="frame" /><div className="scanline" />
        <div className="hint">{hint}</div>
      </div>
      {error && <div className="alert warn">{error}</div>}
      <label className="btn btn-line btn-block">
        {busy ? 'Reading…' : uploadLabel}
        <input type="file" accept="image/*" className="hidden" onChange={onFile} />
      </label>
    </div>
  );
}
