import type { ReactNode } from "react";

// Умумий инлайн-SVG иконка тизими (0 тармоқ сўрови, DESIGN.md §4). Битта чизиқ
// қалинлиги (1.75px) — Pos/Shell/Kds биргаликда ишлатади.
export function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
export type IP = { className?: string };

export const IPlus = (p: IP) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IMinus = (p: IP) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IBack = (p: IP) => <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
export const ISearch = (p: IP) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5" /></Svg>;
export const IFlame = (p: IP) => <Svg {...p}><path d="M12 3s4 3.5 4 8a4 4 0 1 1-8 0c0-1.6.8-2.8 1.6-3.6C10 8.7 12 7 12 3z" /><path d="M12 21a2.4 2.4 0 0 0 2.4-2.4c0-1.6-2.4-3-2.4-3s-2.4 1.4-2.4 3A2.4 2.4 0 0 0 12 21z" /></Svg>;
export const IGift = (p: IP) => <Svg {...p}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8C10.3 8 8.5 7.2 8.5 5.5 8.5 4.4 9.4 4 10 4.4 11.3 5.2 12 8 12 8zM12 8c1.7 0 3.5-.8 3.5-2.5C15.5 4.4 14.6 4 14 4.4 12.7 5.2 12 8 12 8z" /></Svg>;
export const IPrinter = (p: IP) => <Svg {...p}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></Svg>;
export const IChevron = (p: IP) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
export const IUser = (p: IP) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" /></Svg>;
export const IUsers = (p: IP) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M2.5 20c0-3.3 2.8-5 6.5-5s6.5 1.7 6.5 5" /><path d="M16 5.2A3 3 0 0 1 16 11M21.5 20c0-2.6-1.6-4.2-4-4.8" /></Svg>;
export const IBank = (p: IP) => <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></Svg>;
export const ICard = (p: IP) => <Svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></Svg>;
export const IReceipt = (p: IP) => <Svg {...p}><path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3z" /><path d="M8 9h8M8 13h6" /></Svg>;
export const IPlate = (p: IP) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></Svg>;
export const IClock = (p: IP) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IPencil = (p: IP) => <Svg {...p}><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></Svg>;
export const ITrash = (p: IP) => <Svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" /></Svg>;
export const IChat = (p: IP) => <Svg {...p}><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" /></Svg>;
export const IPercent = (p: IP) => <Svg {...p}><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></Svg>;
export const ISplit = (p: IP) => <Svg {...p}><path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6" /><path d="M3 6l3-3 3 3" /><path d="M15 9l3 3 3-3" /></Svg>;
export const ILock = (p: IP) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const ILockOpen = (p: IP) => <Svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></Svg>;
export const ICheck = (p: IP) => <Svg {...p}><path d="M4 12l5 5L20 6" /></Svg>;
export const ISwap = (p: IP) => <Svg {...p}><path d="M7 4 3 8l4 4" /><path d="M3 8h13" /><path d="M17 20l4-4-4-4" /><path d="M21 16H8" /></Svg>;
export const IStop = (p: IP) => <Svg {...p}><path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z" /><path d="M9 9l6 6M15 9l-6 6" /></Svg>;
export const IArrange = (p: IP) => <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>;
export const IMenu = (p: IP) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const ILogout = (p: IP) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 12H3M6 8l-4 4 4 4" /></Svg>;
export const IBell = (p: IP) => <Svg {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10.5 20a1.8 1.8 0 0 0 3 0" /></Svg>;
export const ITv = (p: IP) => <Svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M8 21h8M12 6V3" /></Svg>;
export const IWifiOff = (p: IP) => <Svg {...p}><path d="M3 3l18 18" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><path d="M5 12a10 10 0 0 1 4-2.7M19 12a10 10 0 0 0-4.5-2.9" /><path d="M2 8.8A15 15 0 0 1 6 6.4M22 8.8a15 15 0 0 0-6.5-3.3" /><path d="M12 19h.01" /></Svg>;
export const IWifi = (p: IP) => <Svg {...p}><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12a10 10 0 0 1 14 0" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><path d="M12 19h.01" /></Svg>;
export const IScale = (p: IP) => <Svg {...p}><path d="M12 3v18M7 21h10" /><path d="M5 7h14l-3 6a3 3 0 0 1-8 0z" transform="translate(-2 0)" /><path d="M12 7l7-1M12 7l-7 1" /></Svg>;
export const IGear = (p: IP) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></Svg>;
export const IWarn = (p: IP) => <Svg {...p}><path d="M12 3l9.5 16.5H2.5z" /><path d="M12 10v4M12 17h.01" /></Svg>;
export const ILink = (p: IP) => <Svg {...p}><path d="M9 15l6-6" /><path d="M11 6l1-1a3.5 3.5 0 0 1 5 5l-1 1M13 18l-1 1a3.5 3.5 0 0 1-5-5l1-1" /></Svg>;
export const IMoped = (p: IP) => <Svg {...p}><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8.5 17h7M18 15V9h-3M4 10h5l3 5M14 9h4l2 4" /></Svg>;
export const IBag = (p: IP) => <Svg {...p}><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></Svg>;
export const IFullscreen = (p: IP) => <Svg {...p}><path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" /></Svg>;
export const ISpin = (p: IP) => (
  <Svg className={(p.className ?? "") + " animate-spin motion-reduce:animate-none"}><path d="M12 3a9 9 0 1 0 9 9" /></Svg>
);
