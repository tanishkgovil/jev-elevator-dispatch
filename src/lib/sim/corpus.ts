import type { InfectionClass, Load, Priority } from "../jev/interpretRequest";

// Ground truth for a request. Used only for physics (does it fit?) and
// scoring (how much did this wait matter?), never by a dispatcher.
export interface Truth {
  priority: Priority;
  load: Load;
  infection: InfectionClass;
  discretion: boolean;
  units: number; // physical space used, out of CAR_CAPACITY
}

export interface Template {
  notes: string[];
  from: number[];
  to: number[];
  truth: Truth;
  weight: number; // relative frequency in background traffic
}

const person = (n = 1) => n;
const BED = 10;
const WHEELCHAIR = 3;
const CART = 5;

// Floors: 0 basement (morgue, supply, laundry), 1 lobby/ED, 2 radiology/lab,
// 3 OR, 4 ICU, 5 cardiology, 6 med-surg, 7 oncology, 8 maternity, 9 peds/cafeteria.
export const TEMPLATES: Template[] = [
  // --- STAT ---
  {
    notes: [
      "Bed transport ER to ICU, pt intubated, need to go NOW",
      "trauma pt on stretcher, straight to OR",
      "STEMI pt headed to cath lab, bed + RN",
      "stroke alert pt to CT, on gurney",
    ],
    from: [1],
    to: [2, 3, 4, 5],
    truth: { priority: "stat", load: "bed", infection: "none", discretion: false, units: BED },
    weight: 0.6,
  },
  {
    notes: ["code blue team heading up", "rapid response team responding", "code team en route w/ crash cart"],
    from: [1, 4, 5],
    to: [6, 7, 8, 9],
    truth: { priority: "stat", load: "walking", infection: "none", discretion: false, units: person(4) },
    weight: 0.5,
  },
  // --- URGENT ---
  {
    notes: [
      "pt transfer to med-surg, bed",
      "moving post-op pt to ICU bed",
      "bed transfer from ICU step-down",
    ],
    from: [3, 4, 6],
    to: [4, 6, 7],
    truth: { priority: "urgent", load: "bed", infection: "none", discretion: false, units: BED },
    weight: 0.8,
  },
  {
    notes: [
      "wheelchair pt for scheduled CT, on contact precautions",
      "pt w/ C diff going to radiology in wheelchair",
      "droplet precautions pt to imaging, w/c",
    ],
    from: [6, 7, 9],
    to: [2],
    truth: { priority: "urgent", load: "wheelchair", infection: "isolation", discretion: false, units: WHEELCHAIR },
    weight: 0.6,
  },
  {
    notes: ["stat troponin sample to lab", "blood cultures to lab asap", "ABG sample running to lab"],
    from: [4, 5, 6],
    to: [2],
    truth: { priority: "urgent", load: "walking", infection: "none", discretion: false, units: person(1) },
    weight: 0.8,
  },
  {
    notes: ["pt in wheelchair to dialysis appt", "wheelchair pt going down for x-ray", "discharge pt to lobby, w/c"],
    from: [6, 7, 8],
    to: [1, 2],
    truth: { priority: "urgent", load: "wheelchair", infection: "none", discretion: false, units: WHEELCHAIR },
    weight: 0.8,
  },
  // --- ROUTINE ---
  {
    notes: ["sterile instrument trays for OR restock", "clean supply cart to floor", "central supply delivery, sterile packs"],
    from: [0],
    to: [3, 4, 6, 8],
    truth: { priority: "routine", load: "cart", infection: "sterile", discretion: false, units: CART },
    weight: 0.8,
  },
  {
    notes: ["dirty linen cart to laundry", "biohazard waste bins going down", "soiled utility cart to basement"],
    from: [3, 4, 6, 7, 8],
    to: [0],
    truth: { priority: "routine", load: "cart", infection: "soiled", discretion: false, units: CART },
    weight: 0.8,
  },
  {
    notes: ["morgue transport, pt expired 0300", "decedent to morgue", "taking deceased pt downstairs"],
    from: [4, 6, 7],
    to: [0],
    truth: { priority: "routine", load: "bed", infection: "none", discretion: true, units: BED },
    weight: 0.25,
  },
  {
    notes: ["nurse going to cafeteria", "staff heading to break room", "resident going to pharmacy", "tech going back to unit"],
    from: [1, 2, 3, 4, 5, 6, 7, 8],
    to: [1, 2, 4, 6, 9],
    truth: { priority: "routine", load: "walking", infection: "none", discretion: false, units: person(1) },
    weight: 2.5,
  },
  {
    notes: ["meal cart delivery", "food service cart", "lunch trays going up"],
    from: [9],
    to: [4, 6, 7, 8],
    truth: { priority: "routine", load: "cart", infection: "none", discretion: false, units: CART },
    weight: 0.5,
  },
  // --- VISITOR ---
  {
    notes: [
      "family of 4 going to the cafeteria",
      "visitors going to maternity",
      "couple visiting a patient",
      "visitor to oncology",
      "dad with stroller going to peds",
    ],
    from: [1, 6, 7, 8],
    to: [1, 6, 7, 8, 9],
    truth: { priority: "visitor", load: "walking", infection: "none", discretion: false, units: person(3) },
    weight: 3,
  },
];

// Traffic spawned by surge events, keyed by who shows up.
export const SURGE_NOTES = [
  "night shift nurse heading to unit",
  "staff arriving for shift change",
  "group of visitors",
  "visitor looking for a patient room",
  "family heading upstairs",
];
