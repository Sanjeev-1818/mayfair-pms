import { useEffect, useRef, useState } from 'react';
import { canvasToDataUrl, fileToImage } from '../lib/image.js';

// Takes one photo: selfie (front camera, oval guide) or document (back camera, card guide).
export default function Camera({ facing = 'user', onCapture, hint, shutterLabel = 'Take photo' }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const selfie = facing === 'user';

  useEffect(() => {
    let stream;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        setReady(true);
      } catch {
        setError('Camera is not available. Please allow camera access, or use the button below.');
      }
    })();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [facing]);

  const shoot = () => onCapture(canvasToDataUrl(video.current, { maxSide: selfie ? 720 : 1400, mirror: selfie }));

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = await fileToImage(file);
    onCapture(canvasToDataUrl(img, { maxSide: selfie ? 720 : 1400 }));
  }

  return (
    <div className="stack">
      <div className={`camera${selfie ? '' : ' wide'}`}>
        <video ref={video} playsInline muted autoPlay className={selfie ? 'mirror' : ''} />
        <div className={`frame${selfie ? ' face' : ''}`} />
        {hint && <div className="hint">{hint}</div>}
      </div>
      {error && <div className="alert warn">{error}</div>}
      <button className="btn btn-gold btn-block btn-xl" onClick={shoot} disabled={!ready}>{shutterLabel}</button>
      <label className="btn btn-ghost btn-block">
        Use a photo from the gallery
        <input type="file" accept="image/*" capture={facing === 'user' ? 'user' : 'environment'} className="hidden" onChange={onFile} />
      </label>
    </div>
  );
}
