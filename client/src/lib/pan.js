// Reads the PAN number from a photo of the PAN card, on the phone (free, no upload needed for reading).
// The 10-character PAN has a fixed shape (AAAAA9999A), so common OCR mix-ups can be corrected.
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
const TO_DIGIT = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };

export function findPan(text) {
  const tokens = String(text || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/);
  for (const raw of tokens) {
    if (raw.length !== 10) continue;
    const fixed = raw.split('').map((ch, i) => (i < 5 || i === 9 ? TO_LETTER[ch] || ch : TO_DIGIT[ch] || ch)).join('');
    if (/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/.test(fixed)) return fixed;
  }
  return null;
}

let workerPromise;
export function preloadOcr() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
  }
  return workerPromise;
}

export async function ocrImage(image) {
  const worker = await preloadOcr();
  const { data } = await worker.recognize(image);
  return data.text || '';
}
