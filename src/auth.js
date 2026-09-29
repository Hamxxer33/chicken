import crypto from "node:crypto";

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function validateInitData(initData, botToken, maxAgeSec = 24 * 60 * 60) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheck = pairs.join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (Math.abs(Date.now() / 1000 - authDate) > maxAgeSec) return null;

  let user;
  try {
    user = JSON.parse(params.get("user") || "");
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    return null;
  }
  return {
    user,
    startParam: params.get("start_param") || "",
    authDate,
  };
}
