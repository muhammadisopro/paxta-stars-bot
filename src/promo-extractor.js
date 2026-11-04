/**
 * Extracts promo codes from messages posted by @umar
 * Handles patterns such as:
 * - /promo MASK
 * - @StarsBot команду /promo AUCTIONS777
 * - написать @StarsBot команду /promo AFDSFR
 * - @StarsBot команду /promo 2NOV
 * - Or plain uppercase promo words in text
 */
export function extractPromoCode(text) {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: /promo <CODE>
  const promoMatch = text.match(/\/promo\s+([A-Za-z0-9_-]+)/i);
  if (promoMatch) {
    return promoMatch[1].trim();
  }

  // Pattern 2: Explicit keyword prefixes (promokod, promo, kod, code)
  const keywordMatch = text.match(/(?:promo(?:kod)?|kod|code)[:\s]+([A-Za-z0-9_-]+)/i);
  if (keywordMatch) {
    return keywordMatch[1].trim();
  }

  // Common noise words to ignore when scanning for uppercase codes
  const ignoredTokens = new Set([
    'STARSBOT', 'STARS_BOT', 'PAXTA', 'PAXTAGRAM', 'BOT', 'ADMIN',
    'SALOM', 'HAMMAGA', 'DIQQAT', 'GURUH', 'KOD', 'PROMO', 'PROMOCODE',
    'VIP', 'NEW', 'KANAL', 'GROUP', 'CHAT', 'ONLINE', 'HTTP', 'HTTPS',
    'WWW', 'TELEGRAM', 'LINK', 'UCHUN', 'HAMMA', 'KOMANDU'
  ]);

  // Pattern 3: Uppercase tokens of length 3-30 containing at least one letter
  const tokens = text.match(/\b[A-Za-z0-9_-]{3,30}\b/g) || [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (!ignoredTokens.has(upper) && /[A-Z]/.test(upper) && (token === upper || /[0-9]/.test(token))) {
      return token.trim();
    }
  }

  // Pattern 4: Whole text is a single code (e.g. "MASK" or "2NOV")
  const trimmed = text.trim();
  if (/^[A-Za-z0-9_-]{2,30}$/.test(trimmed) && !ignoredTokens.has(trimmed.toUpperCase())) {
    return trimmed;
  }

  return null;
}
