import QRCode from 'qrcode';
import { Asset } from '../types';

// In-memory LRU-like cache for generated QR codes so identical requests don't re-render
const qrCache = new Map<string, string>();

/**
 * Returns a deterministic QR Code data URL for an asset.
 * Encodes the standard format: HEXON_PREVENTIVA_ASSET_ID_${assetId}
 */
export async function getAssetQrDataUrl(assetId: string, size = 180): Promise<string> {
  const content = `HEXON_PREVENTIVA_ASSET_ID_${assetId}`;
  const cacheKey = `${content}_${size}`;
  
  if (qrCache.has(cacheKey)) {
    return qrCache.get(cacheKey)!;
  }

  try {
    const dataUrl = await QRCode.toDataURL(content, {
      width: size,
      margin: 1,
      color: {
        dark: '#0b1c30',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'M'
    });
    
    // Keep cache reasonable in size
    if (qrCache.size > 500) {
      const firstKey = qrCache.keys().next().value;
      if (firstKey) qrCache.delete(firstKey);
    }
    
    qrCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch (err) {
    console.warn('Fallback generating QR code:', err);
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(content)}`;
  }
}

/**
 * Triggers browser download of the asset's QR code image.
 */
export async function downloadAssetQrCode(assetCode: string, assetId: string, size = 400): Promise<void> {
  const dataUrl = await getAssetQrDataUrl(assetId, size);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `qrcode_${assetCode || assetId}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Opens a print-ready asset tag window with the dynamically rendered QR code.
 */
export async function printAssetTag(asset: Asset): Promise<void> {
  const qrUrl = await getAssetQrDataUrl(asset.id, 260);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Permita pop-ups no navegador para imprimir a plaqueta.');
    return;
  }

  const comarcaStr = asset.location ? asset.location.split(' - ')[0] : 'Geral';

  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Plaqueta de Ativo - ${asset.code}</title>
        <style>
          body { 
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            text-align: center; 
            padding: 40px 20px; 
            color: #0f172a; 
            background: #fff;
          }
          .card { 
            border: 2.5px solid #0f172a; 
            padding: 24px; 
            border-radius: 14px; 
            max-width: 290px; 
            margin: 0 auto; 
            box-shadow: 0 4px 10px -2px rgba(0, 0, 0, 0.1); 
          }
          .logo { 
            font-size: 10px; 
            font-weight: 900; 
            color: #64748b; 
            letter-spacing: 0.15em; 
            margin-bottom: 16px; 
            text-transform: uppercase;
          }
          .qr { 
            width: 180px; 
            height: 180px; 
            margin: 0 auto 12px auto; 
            display: block; 
            border-radius: 6px;
          }
          .code { 
            font-family: monospace; 
            font-size: 14px; 
            font-weight: 800; 
            background: #f1f5f9; 
            border: 1px solid #cbd5e1;
            padding: 4px 10px; 
            border-radius: 6px; 
            color: #1e1b4b; 
            display: inline-block; 
            letter-spacing: 0.05em;
          }
          h1 { 
            margin: 12px 0 4px 0; 
            font-size: 17px; 
            font-weight: 800; 
            letter-spacing: -0.02em; 
            line-height: 1.3;
          }
          p { 
            margin: 0 0 16px 0; 
            font-size: 11px; 
            color: #475569; 
            font-weight: 700; 
            text-transform: uppercase; 
          }
          @media print {
            body { padding: 0; }
            .card { box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">HEXON PREVENTIVA</div>
          <img class="qr" src="${qrUrl}" alt="QR Code" />
          <div class="code">${asset.code}</div>
          <h1>${asset.name}</h1>
          <p>${asset.sector} &bull; ${comarcaStr}</p>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 250);
          };
        </script>
      </body>
    </html>
  `);
  win.document.close();
}
