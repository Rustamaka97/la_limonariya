import { useEffect } from "react";
import { trpc } from "../trpc";
import { uuid } from "./uuid";

// Қурилма heartbeat — логин бўлган клиент 30 сонияда серверга «тирикман» дейди.
// Сис-админ «Статус → Қурилмалар» панели шундан ким онлайнлигини кўради.
// deviceId — localStorage'да барқарор (браузер алмашса янги қурилма саналади).

const KEY = "limon.deviceId";

function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // private mode / storage йўқ — сессиягина яшайдиган id
    return `ephemeral-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function detect(): { kind: "terminal" | "pwa" | "browser"; platform: string } {
  const ua = navigator.userAgent;
  const kind = ua.includes("LaLimonPOS")
    ? "terminal"
    : window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (navigator as { standalone?: boolean }).standalone
      ? "pwa"
      : "browser";
  const platform = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac/.test(ua)
          ? "Mac"
          : "бошқа";
  return { kind, platform };
}

export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      const { kind, platform } = detect();
      trpc.system.heartbeat
        .mutate({ deviceId: deviceId(), kind, platform })
        .catch(() => {}); // офлайн/хато — жим, кейинги циклда уринади
    };
    send();
    const t = setInterval(send, 30_000);
    return () => clearInterval(t);
  }, [enabled]);
}
