/**
 * Amex MR airline transfer partners.
 * Each program has: name, ratio (MR-to-program), bonus_ratio (null = no active bonus),
 * slug (Seats.aero source param, null = point.me-only), airline (IATA code).
 */
export const PROGRAMS = {
  aerlingus: { name: "Aer Lingus AerClub", ratio: 1, bonus_ratio: null, slug: null, airline: "EI" },
  aeromexico: { name: "Aeromexico Rewards", ratio: 1.6, bonus_ratio: null, slug: null, airline: "AM" },
  aeroplan: { name: "Aeroplan", ratio: 1, bonus_ratio: null, slug: null, airline: "AC" },
  flyingblue: { name: "Flying Blue", ratio: 1, bonus_ratio: null, slug: "flyingblue", airline: "AF/KL" },
  ana: { name: "ANA Mileage Club", ratio: 1, bonus_ratio: null, slug: null, airline: "NH" },
  lifemiles: { name: "Avianca LifeMiles", ratio: 1, bonus_ratio: null, slug: null, airline: "AV" },
  avios: { name: "British Airways", ratio: 1, bonus_ratio: null, slug: null, airline: "BA" },
  cathay: { name: "Cathay Pacific", ratio: 0.8, bonus_ratio: null, slug: null, airline: "CX" },
  delta: { name: "Delta SkyMiles", ratio: 1, bonus_ratio: null, slug: "delta", airline: "DL" },
  emirates: { name: "Emirates Skywards", ratio: 0.8, bonus_ratio: null, slug: null, airline: "EK" },
  etihad: { name: "Etihad Guest", ratio: 1, bonus_ratio: null, slug: "etihad", airline: "EY" },
  iberia: { name: "Iberia Plus", ratio: 1, bonus_ratio: null, slug: null, airline: "IB" },
  jetblue: { name: "JetBlue TrueBlue", ratio: 0.8, bonus_ratio: null, slug: "jetblue", airline: "B6" },
  qantas: { name: "Qantas Frequent Flyer", ratio: 1, bonus_ratio: null, slug: null, airline: "QF" },
  qatar: { name: "Qatar Airways Privilege Club", ratio: 1, bonus_ratio: null, slug: null, airline: "QR" },
  singapore: { name: "Singapore KrisFlyer", ratio: 1, bonus_ratio: null, slug: null, airline: "SQ" },
  virgin: { name: "Virgin Atlantic", ratio: 1, bonus_ratio: null, slug: "virginatlantic", airline: "VS" },
};
