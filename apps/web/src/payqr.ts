// Payme/Click QR тўлов — мижоз чекдаги QR'ни ўз иловасида сканерлаб тўлайди.
// Deep-link CLIENT-side, детерминик (API чақируви йўқ) — сумма ва заказ рефи
// кодланади. Мerchant/service ID app_meta'дан (эга киритади, принтер IP каби).
// Тўлов ТАСДИҒИ ҳозирча кассир қўлда («Тўланди») — вебхук интеграцияси кейинги фаза.

export type PayConfig = {
  paymeMerchantId?: string | null;
  clickServiceId?: string | null;
  clickMerchantId?: string | null;
};

function b64(s: string): string {
  // браузерда btoa, node/тестда Buffer — latin1'га мос (params ASCII)
  if (typeof btoa !== "undefined") return btoa(s);
  return Buffer.from(s, "utf8").toString("base64");
}

// Payme checkout: base64(m=..;ac.order_id=..;a=<тийин>) → https://checkout.paycom.uz/<b64>
// Сумма ТИЙИНда (сўм × 100) — Payme стандарти.
export function paymeUrl(cfg: PayConfig, som: number, orderRef: string): string | null {
  if (!cfg.paymeMerchantId) return null;
  const tiyin = Math.round(som * 100);
  const params = `m=${cfg.paymeMerchantId};ac.order_id=${orderRef};a=${tiyin}`;
  return `https://checkout.paycom.uz/${b64(params)}`;
}

// Click: https://my.click.uz/services/pay?service_id=..&merchant_id=..&amount=<сўм>&transaction_param=..
// Сумма СЎМда (Payme'дан фарқи).
export function clickUrl(cfg: PayConfig, som: number, orderRef: string): string | null {
  if (!cfg.clickServiceId || !cfg.clickMerchantId) return null;
  const q = new URLSearchParams({
    service_id: String(cfg.clickServiceId),
    merchant_id: String(cfg.clickMerchantId),
    amount: String(som),
    transaction_param: orderRef,
  });
  return `https://my.click.uz/services/pay?${q.toString()}`;
}

export function payUrl(
  method: "payme" | "click",
  cfg: PayConfig,
  som: number,
  orderRef: string,
): string | null {
  return method === "payme" ? paymeUrl(cfg, som, orderRef) : clickUrl(cfg, som, orderRef);
}
