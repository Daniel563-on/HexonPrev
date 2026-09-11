import React, { useState, useEffect } from 'react';
import { getAssetQrDataUrl } from '../utils/qrUtils';
import { QrCode } from 'lucide-react';

interface AssetQrCodeProps {
  assetId: string;
  size?: number;
  className?: string;
  alt?: string;
}

export const AssetQrCode: React.FC<AssetQrCodeProps> = ({
  assetId,
  size = 120,
  className = '',
  alt = 'Asset QR Code'
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    getAssetQrDataUrl(assetId, size)
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [assetId, size]);

  if (loading || !dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`bg-slate-100/80 rounded-lg flex flex-col items-center justify-center text-slate-400 animate-pulse ${className}`}
      >
        <QrCode className="w-6 h-6 opacity-40 animate-pulse" />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className={className}
      loading="lazy"
    />
  );
};

export default AssetQrCode;
