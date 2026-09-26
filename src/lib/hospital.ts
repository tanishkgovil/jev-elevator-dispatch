// Floor 0 is the basement. Labels are what Jev sees, so they carry the
// clinical meaning of each floor (e.g. ED → ICU implies urgency).
export const FLOORS = [
  { floor: 0, short: "B · Morgue/Supply", label: "Basement: Morgue, Central Supply, Laundry" },
  { floor: 1, short: "1 · Lobby/ED", label: "Floor 1: Main Lobby, Emergency Department" },
  { floor: 2, short: "2 · Radiology/Lab", label: "Floor 2: Radiology, Lab" },
  { floor: 3, short: "3 · Surgery", label: "Floor 3: Operating Rooms" },
  { floor: 4, short: "4 · ICU", label: "Floor 4: ICU" },
  { floor: 5, short: "5 · Cardiology", label: "Floor 5: Cardiology, Cath Lab" },
  { floor: 6, short: "6 · Med-Surg", label: "Floor 6: Medical-Surgical Ward" },
  { floor: 7, short: "7 · Oncology", label: "Floor 7: Oncology" },
  { floor: 8, short: "8 · Maternity", label: "Floor 8: Maternity" },
  { floor: 9, short: "9 · Peds/Cafeteria", label: "Floor 9: Pediatrics, Cafeteria" },
] as const;

export const FLOOR_COUNT = FLOORS.length;

export function floorLabel(floor: number): string {
  return FLOORS[floor]?.label ?? `Floor ${floor}`;
}
