// One merchant must stay one merchant. Card descriptors carry processor
// prefixes, store numbers, cities and reference codes ("SQ *BLUE BOTTLE 0423
// OAKLAND CA", "AMZN Mktp US*2K4L19"), and grouping on the raw string splits a
// single coffee shop into dozens of "merchants" — which breaks recurring
// detection, top-merchant rankings and rules alike.

const PREFIXES = [
  // Card processors and portals in front of the merchant: Square, Shopify, Toast,
  // Chase Travel (CL), Fiserv (FSI), Eventbrite, FastSpring, Lightspeed, DoorDash, Instacart.
  /^(sq|sp|tst|pp|pos|ach|ckcd|dbt|debit|purchase|recurring|web|ppd|ccd|cl|fsi|eb|fs|ls|dd|ic)\s*\*\s*/i,
  /^(paypal|venmo|zelle)\s*\*\s*/i,
  /^(pos|debit card|checkcard|purchase authorized on \d{2}\/\d{2})\s+/i,
];

const NOISE = [
  // ACH boilerplate: "HARBOR CU ACH PAY PPD ID: 123456789", "ACME DES:PAYROLL ID:…"
  /\s+ach\s+(pay|pmt|payment|debit|credit|trnsfr|transfer|withdrawal|deposit|web)\b.*$/i,
  /\s+(ppd|ccd|web|tel|ctx|iat)\s+id\b.*$/i,
  /\s+des:.*$/i,
  /\s+ending in\b.*$/i, // "Payment to Chase card ending in 1111 09/23"
  /\s+#?\d{3,}.*$/, // store numbers and everything after
  /\s+[a-z0-9]*\d[a-z0-9]{5,}\b.*$/i, // reference codes
  /\*[a-z0-9]{4,}.*$/i, // "*2K4L19"
  /\s+(inc|llc|ltd|corp|co)\.?$/i,
  /\s+\b[A-Z]{2}\s*$/, // trailing state code
  /\.com\b.*$/i,
  /\s{2,}/g,
];

/** Stable grouping key: lowercase, noise stripped. */
export function merchantKey(raw: string): string {
  let s = raw.trim();
  for (const p of PREFIXES) s = s.replace(p, "");
  for (const n of NOISE) s = s.replace(n, " ");
  s = s
    .toLowerCase()
    .replace(/[^a-z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || raw.trim().toLowerCase();
}

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/** Display form when the provider has no clean merchant name. */
export function prettifyMerchant(raw: string): string {
  const key = merchantKey(raw);
  return key
    .split(" ")
    .map((w) =>
      w.length <= 3 && /^(usa|us|nyc|atm|bp|cvs|ups|tj|amc|hbo|cu|fcu)$/.test(w)
        ? w.toUpperCase()
        : w,
    )
    .map((w, i) =>
      w === w.toUpperCase() || (i > 0 && SMALL_WORDS.has(w))
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}
