// QR reading with zxing-wasm (works on iPhone and Android, reads the dense Aadhaar Secure QR).
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });

const OPTIONS = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 };

export async function readQr(input) {
  const results = await readBarcodes(input, OPTIONS);
  const hit = results.find((r) => r.isValid && r.text);
  return hit ? hit.text : null;
}
