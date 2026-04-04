/**
 * Amex MR airline transfer partners.
 * Each program has: name, ratio (MR-to-program), bonus_ratio (null = no active bonus),
 * slug (Seats.aero source param, null = point.me-only), airline (IATA code).
 */
export const PROGRAMS = {
  flyingblue: { name: "Flying Blue", ratio: 1, bonus_ratio: null, slug: "flyingblue", airline: "AF/KL" },
  virgin: { name: "Virgin Atlantic", ratio: 1, bonus_ratio: null, slug: "virginatlantic", airline: "VS" },
  avios: { name: "British Airways", ratio: 1, bonus_ratio: null, slug: null, airline: "BA" }, // Not on Seats.aero partner API
  iberia: { name: "Iberia Avios", ratio: 1, bonus_ratio: null, slug: null, airline: "IB" },
  aeroplan: { name: "Aeroplan", ratio: 1, bonus_ratio: null, slug: null, airline: "AC" }, // Not on Seats.aero partner API
  ana: { name: "ANA Mileage Club", ratio: 1, bonus_ratio: null, slug: null, airline: "NH" }, // Not on Seats.aero partner API
  singapore: { name: "Singapore KrisFlyer", ratio: 1, bonus_ratio: null, slug: null, airline: "SQ" }, // Not on Seats.aero partner API
  delta: { name: "Delta SkyMiles", ratio: 1, bonus_ratio: null, slug: "delta", airline: "DL" },
  etihad: { name: "Etihad Guest", ratio: 1, bonus_ratio: null, slug: "etihad", airline: "EY" },
  emirates: { name: "Emirates Skywards", ratio: 1, bonus_ratio: null, slug: null, airline: "EK" }, // Not on Seats.aero partner API
  cathay: { name: "Cathay Pacific", ratio: 1, bonus_ratio: null, slug: null, airline: "CX" },
  lifemiles: { name: "Avianca LifeMiles", ratio: 1, bonus_ratio: null, slug: null, airline: "AV" }, // Not on Seats.aero partner API
  hawaiian: { name: "Hawaiian Miles", ratio: 1, bonus_ratio: null, slug: null, airline: "HA" },
  jetblue: { name: "JetBlue TrueBlue", ratio: 0.8, bonus_ratio: null, slug: "jetblue", airline: "B6" },
  copa: { name: "Copa ConnectMiles", ratio: 1, bonus_ratio: null, slug: null, airline: "CM" },
};
