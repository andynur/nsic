export type Dashboard = {
  generated_at: number;
  from: number;
  days: number;
  projects: { id: string; name: string }[];
  total: number;
  open: number;
  attention_count: number;
  cost_usd: number;
  statuses: { status: string; count: number }[];
  evidence: { level: number; count: number }[];
  daily: { day: string; cost_usd: number }[];
  workload: { id: string; name: string; open: number; attention: number }[];
  attention: { key: string; title: string; status: string; priority: string; updated_at: number; cost_usd: number; budget_usd: number }[];
};
