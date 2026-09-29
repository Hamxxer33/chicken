// Telegram does not publish account creation dates. These anchors are a cleaned,
// time-sorted subset of community-collected id/date pairs (the same kind of
// estimate the 2024 dog mini app used). Dates are interpolated between anchors.

const ANCHORS = [
  [2768409, 1383264000000],
  [7679610, 1388448000000],
  [11538514, 1391212000000],
  [15835244, 1392940000000],
  [23646077, 1393459000000],
  [38015510, 1393632000000],
  [44634663, 1399334000000],
  [46145305, 1400198000000],
  [54845238, 1411257000000],
  [63263518, 1414454000000],
  [101260938, 1425600000000],
  [101323197, 1426204000000],
  [103151531, 1433376000000],
  [109393468, 1439078000000],
  [112594714, 1439683000000],
  [124872445, 1439856000000],
  [125828524, 1444003000000],
  [133909606, 1444176000000],
  [143445125, 1448928000000],
  [148670295, 1452211000000],
  [152079341, 1453420000000],
  [171295414, 1457481000000],
  [181783990, 1460246000000],
  [222021233, 1465344000000],
  [225034354, 1466208000000],
  [278941742, 1473465000000],
  [285253072, 1476835000000],
  [294851037, 1479600000000],
  [297621225, 1481846000000],
  [328594461, 1482969000000],
  [337808429, 1487707000000],
  [341546272, 1487782000000],
  [352940995, 1487894000000],
  [369669043, 1490918000000],
  [400169472, 1501459000000],
  [805158066, 1563208000000],
  [1974255900, 1634000000000],
  [5520018289, 1721847912670],
];

export function estimateJoinedMs(id) {
  const n = typeof id === "bigint" ? Number(id) : Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("bad telegram id");
  }
  if (n <= ANCHORS[0][0]) return ANCHORS[0][1];
  const last = ANCHORS[ANCHORS.length - 1];
  const prev = ANCHORS[ANCHORS.length - 2];
  if (n >= last[0]) {
    const rate = (last[1] - prev[1]) / (last[0] - prev[0]);
    return Math.round(last[1] + (n - last[0]) * rate);
  }
  let lo = 0;
  let hi = ANCHORS.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (ANCHORS[mid][0] <= n) lo = mid;
    else hi = mid;
  }
  const [id0, t0] = ANCHORS[lo];
  const [id1, t1] = ANCHORS[hi];
  const ratio = (n - id0) / (id1 - id0);
  return Math.round(t0 + ratio * (t1 - t0));
}

export function estimateJoined(id, now = new Date()) {
  const ms = Math.min(estimateJoinedMs(id), now.getTime());
  return new Date(ms);
}

export function ageLabel(joined, now) {
  const months = Math.max(
    0,
    Math.floor((now.getTime() - joined.getTime()) / (30.4375 * 24 * 60 * 60 * 1000)),
  );
  const years = Math.floor(months / 12);
  if (years >= 2) return `${years} years on Telegram`;
  if (years === 1) return "1 year on Telegram";
  if (months >= 2) return `${months} months on Telegram`;
  return "New on Telegram";
}
