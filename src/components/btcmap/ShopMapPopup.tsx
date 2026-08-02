/**
 * Rich merchant popup card that appears when clicking a shop on the map.
 * Styled after BTC Map's merchant sidebar — shows name, status, hours,
 * contact info, payment badges, and quick action buttons.
 */

import { useEffect } from 'react';
import {
  X, Clock, Phone, Link2, Mail, MapPin, Navigation,
  Share2, ExternalLink, Zap, Bitcoin,
} from 'lucide-react';
import type { BtcShop } from '@/lib/btcmap/btcmap';
import { safeUrl } from '@/lib/btcmap/discover';
import { sanitizeTel, sanitizeEmail, isValidCoordinate, getTypeIcon } from '@/lib/btcmap/discover';
import { openUrl } from '@/lib/downloadFile';

export interface PopupShop extends BtcShop {
  distance?: string;
}

interface ShopMapPopupProps {
  shop: PopupShop | null;
  enriched: Partial<BtcShop> | null;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

export default function ShopMapPopup({
  shop,
  enriched,
  onClose,
  theme = 'dark',
}: ShopMapPopupProps): React.JSX.Element | null {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!shop) return null;

  const isDark = theme === 'dark';
  const phone = shop.phone || enriched?.phone;
  const website = safeUrl(shop.website || enriched?.website);
  const email = sanitizeEmail(shop.email || enriched?.email);
  const hours = shop.hours || enriched?.hours;
  const instagram = safeUrl(shop.instagram || enriched?.instagram);
  const facebook = safeUrl(shop.facebook || enriched?.facebook);
  const twitter = safeUrl(shop.twitter || enriched?.twitter);

  const handleNavigate = async () => {
    if (!isValidCoordinate(shop.lat, shop.lon)) return;
    const url = `https://www.openstreetmap.org/directions?from=&to=${shop.lat},${shop.lon}`;
    // openUrl bridges web + native (native presents the share sheet; window.open
    // alone is blocked inside WKWebView).
    await openUrl(url).catch(() => {});
  };

  const handleOpenExternal = (url: string) => {
    void openUrl(url).catch(() => {});
  };

  const handleShare = async () => {
    const osmId = shop.osmId?.replace(/\D/g, '');
    const shareUrl = osmId
      ? `https://btcmap.org/map?merchant=${osmId}`
      : 'https://btcmap.org/map';
    const shareData = {
      title: shop.name,
      text: `Check out ${shop.name} on BTC Map!`,
      url: shareUrl,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareData.url).catch(() => {});
    }
  };

  return (
    <div className="absolute top-3 left-3 z-[500] w-[min(280px,calc(100vw-1.5rem))] sm:w-[320px] max-w-[calc(100%-1.5rem)] animate-in fade-in slide-in-from-left-2 duration-200">
      <div className={`rounded-2xl border shadow-2xl overflow-hidden ${
        isDark
          ? 'bg-card/95 border-border backdrop-blur-md'
          : 'bg-card/95 border-border backdrop-blur-md'
      }`}>
        {/* Header */}
        <div className="p-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                shop.addressKnown === false
                  ? 'bg-muted text-muted-foreground border border-border'
                  : shop.verified
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
                    : 'bg-purple-500/10 border border-purple-500/20 text-purple-500'
              }`}>
                {getTypeIcon(shop.type)}
              </div>
              <div className="min-w-0">
                <h3 className={`text-sm font-bold truncate ${isDark ? 'text-card-foreground' : 'text-card-foreground'}`}>
                  {shop.name}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {shop.addressKnown === false ? (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Address unknown</span>
                  ) : (
                    <>
                      {shop.lightning && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-500/10 text-amber-950 dark:text-amber-200 px-1.5 py-0.5 rounded">
                          <Zap className="w-2.5 h-2.5" /> Lightning
                        </span>
                      )}
                      {shop.onchain && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-orange-500/10 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded">
                          <Bitcoin className="w-2.5 h-2.5" /> On-chain
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close popup"
              className="min-w-[44px] min-h-[44px] rounded-lg shrink-0 transition-colors flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Info Rows */}
        {(hours || phone || website || email || shop.address) && (
          <div className="px-4 py-2 space-y-2 border-y border-border">
            {hours && (
              <div className="flex items-center gap-2.5">
                <Clock className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="text-xs text-muted-foreground">{hours}</span>
              </div>
            )}
            {(() => {
              const cleanPhone = sanitizeTel(phone);
              return cleanPhone ? (
                <div className="flex items-center gap-2.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <a
                    href={`tel:${cleanPhone}`}
                    className="text-xs text-primary hover:text-primary/80 underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {cleanPhone}
                  </a>
                </div>
              ) : null;
            })()}
            {website && (
              <div className="flex items-center gap-2.5">
                <Link2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <button
                  type="button"
                  className="text-xs text-primary hover:text-primary/80 underline truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenExternal(website);
                  }}
                >
                  {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </button>
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a
                  href={`mailto:${email}`}
                  className="text-xs text-primary hover:text-primary/80 underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {email}
                </a>
              </div>
            )}
            {shop.address && shop.address !== 'Address unknown' && (
              <div className="flex items-center gap-2.5">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">{shop.address}</span>
              </div>
            )}
          </div>
        )}

        {/* Social Links */}
        {(instagram || facebook || twitter) && (
          <div className="px-4 py-2 flex items-center gap-3 border-b border-border">
            {instagram && (
              <button type="button" onClick={() => handleOpenExternal(instagram)} className="text-[10px] text-pink-500 hover:text-pink-400 underline">Instagram</button>
            )}
            {facebook && (
              <button type="button" onClick={() => handleOpenExternal(facebook)} className="text-[10px] text-blue-500 hover:text-blue-400 underline">Facebook</button>
            )}
            {twitter && (
              <button type="button" onClick={() => handleOpenExternal(twitter)} className="text-[10px] text-sky-500 hover:text-sky-400 underline">Twitter</button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="p-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleNavigate}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
          >
            <Navigation className="w-3.5 h-3.5" />
            Navigate
          </button>
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share shop"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          {website && (
            <button
              type="button"
              aria-label="Open merchant website"
              onClick={() => handleOpenExternal(website)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
