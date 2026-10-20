export const roles = {
  ADMIN: "Admin",
  HR: "HR",
  MANAGER: "หัวหน้างาน",
  COACH: "Driver Coach",
  SAFETY: "Safety",
  DISPATCH_MANAGER: "ผู้จัดการจัดส่ง",
  DRIVER_TRAINER: "Driver Trainer",
} as const;
export type Role = keyof typeof roles;
export const statuses: Record<string, string> = {
  HR_REVIEW: "รอ HR ตรวจ",
  WAITING_INFO: "รอข้อมูลเพิ่ม",
  INTERVIEW: "รอสัมภาษณ์",
  HIRED: "รับเข้าทำงาน",
  STARTED: "เริ่มงานแล้ว",
  RESERVE: "ผู้สมัครสำรอง",
  REJECTED: "ไม่ผ่าน",
  WITHDRAWN: "ถอนตัว",
  NO_SHOW: "ไม่มาเริ่มงาน",
  CANCELLED: "ยกเลิกรับ",
};
export const categories: Record<string, string> = {
  GENERAL: "ทั่วไป",
  COACH: "Driver Coach",
  SAFETY: "Safety",
  DRIVER_TRAINER: "Driver Trainer",
};
export function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function isoDate(value: string): string {
  if (!value) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) throw Error("กรอกวันที่ dd/mm/yyyy เช่น 19/10/2026 (ค.ศ.)");
  const s = `${m[3]}-${m[2]}-${m[1]}`;
  if (new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s)
    throw Error("วันที่ไม่ถูกต้อง");
  return s;
}
export function date(value: unknown): string {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
    : "—";
}
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function retention(
  rows: {
    actual_start_date: string | null;
    resignation_date: string | null;
    employment_status: string;
  }[],
  asOf = today(),
) {
  const from = new Date(asOf + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 89);
  const first = from.toISOString().slice(0, 10);
  const cohort = rows.filter(
    (r) =>
      r.actual_start_date &&
      r.actual_start_date >= first &&
      r.actual_start_date <= asOf,
  );
  const active = cohort.filter(
    (r) =>
      r.employment_status === "ACTIVE" &&
      (!r.resignation_date || r.resignation_date > asOf),
  ).length;
  return {
    from: first,
    to: asOf,
    total: cohort.length,
    active,
    rate: cohort.length
      ? Math.round((active / cohort.length) * 10000) / 100
      : null,
  };
}
export function canTrain(
  role: Role,
  units: string[],
  app: { hiring_unit: string; coach_id: string | null },
  userId: string,
  category: string,
) {
  if (["ADMIN", "HR", "DISPATCH_MANAGER"].includes(role)) return true;
  if (role === "MANAGER") return units.includes(app.hiring_unit);
  if (role === "COACH") return app.coach_id === userId && category === "COACH";
  return role === category && ["SAFETY", "DRIVER_TRAINER"].includes(role);
}
export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  units: string[];
  active: boolean;
  version: number;
}
export interface Applicant {
  id: string;
  full_name: string;
  position: string;
  phone: string;
  original_unit: string;
  hiring_unit: string;
  status: string;
  created_at: string;
  version: number;
  owner_id: string | null;
  coach_id: string | null;
  supervisor_id: string | null;
  slot_id: string | null;
  actual_start_date: string | null;
  scheduled_start_date: string | null;
  resignation_date: string | null;
  employment_status: string;
  round: number;
  data: Record<string, string>;
}

export function requiresAgeApproval(
  position: string,
  birth: string | undefined,
  asOf = today(),
): boolean {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return true;
  const age =
    Number(asOf.slice(0, 4)) -
    Number(birth.slice(0, 4)) -
    (asOf.slice(5) < birth.slice(5) ? 1 : 0);
  return age < (position === "DRIVER" ? 25 : 18);
}
