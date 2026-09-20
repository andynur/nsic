import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type Toast = { id: number; text: string; tone: "info" | "error" | "warning" | "success" };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const t = { id: ++seq, text, tone };
    setItems((xs) => [...xs.slice(-2), t]);
    if (tone !== "error") setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.tone === "error" || t.tone === "warning" ? <Icon name="warning" className={t.tone === "error" ? "err-text" : "warn-text"} /> : t.tone === "success" ? <Icon name="check" className="ok-text" /> : null}
            <span className="grow">{t.text}</span>
            <button className="btn ghost sm" aria-label="Dismiss notification" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}><Icon name="x" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
