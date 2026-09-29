// The 2024 dog drop never published its age curve. Chicken keeps the public
// rules (older account, Premium, OG, 10% of a friend's score, 20,000 every
// 5 friends, wallet 1,000, small tasks) and uses this age table.

export const RULES = Object.freeze({
  premiumRate: 0.2,
  ogThroughYear: 2017,
  ogRate: 0.1,
  referralRate: 0.1,
  milestoneEvery: 5,
  milestoneBonus: 20_000,
  tasks: Object.freeze({
    wallet: 1_000,
    channel: 500,
    community: 50,
    share: 200,
  }),
});

// Score at each whole year on Telegram. Months are prorated. Year 13 is the cap.
const AGE_TABLE = [
  400, 900, 1_800, 3_200, 5_200, 8_000, 12_000, 17_000, 24_000, 33_000, 45_000,
  62_000, 82_000, 110_000,
];

export function ageScore(joined, now) {
  const years = Math.max(
    0,
    (now.getTime() - joined.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
  const capped = Math.min(years, AGE_TABLE.length - 1);
  const index = Math.floor(capped);
  if (index >= AGE_TABLE.length - 1) return AGE_TABLE[AGE_TABLE.length - 1];
  const frac = capped - index;
  return Math.round(AGE_TABLE[index] + (AGE_TABLE[index + 1] - AGE_TABLE[index]) * frac);
}

export function scoreParts(joined, isPremium, now) {
  const age = ageScore(joined, now);
  const premium = isPremium ? Math.round(age * RULES.premiumRate) : 0;
  const og =
    joined.getUTCFullYear() <= RULES.ogThroughYear
      ? Math.round(age * RULES.ogRate)
      : 0;
  return { age, premium, og, base: age + premium + og };
}

export function referralShare(friendBase) {
  return Math.round(friendBase * RULES.referralRate);
}

export function milestoneBonus(friendCount) {
  return Math.floor(friendCount / RULES.milestoneEvery) * RULES.milestoneBonus;
}

export function validTonAddress(value) {
  const s = String(value || "").trim();
  return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(s) || /^-?\d+:[0-9a-fA-F]{64}$/.test(s);
}
