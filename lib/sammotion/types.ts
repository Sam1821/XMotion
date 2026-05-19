// SamMotion — shared types

// ───────────────────────────── Muscles (with sub-heads) ─────────────────────────────
export type MuscleId =
  // chest
  | "chest_upper" | "chest_mid" | "chest_lower"
  // back
  | "lats" | "traps_upper" | "traps_mid" | "traps_lower" | "rhomboids" | "lower_back" | "rear_delts"
  // shoulders (front + side; rear sits with back)
  | "delts_front" | "delts_side"
  // arms
  | "biceps_long" | "biceps_short" | "brachialis"
  | "triceps_long" | "triceps_lateral" | "triceps_medial"
  | "forearms"
  // core
  | "abs_upper" | "abs_lower" | "obliques"
  // legs
  | "glutes" | "quads_rf" | "quads_vl" | "quads_vm"
  | "hamstrings_bf" | "hamstrings_sm"
  | "adductors" | "abductors"
  | "calves_gastroc" | "calves_soleus"

// Coarse buckets — used for filtering / chart grouping.
export type MuscleGroup = "chest" | "back" | "shoulders" | "biceps" | "triceps" | "forearms" | "core" | "glutes" | "quads" | "hamstrings" | "calves"

// ───────────────────────────── Equipment ─────────────────────────────
export type EquipmentId = string // open string so user-added items work

export interface EquipmentDef {
  label: string
  emoji: string
  cat: string // category label, e.g. "Free Weights"
}

// ───────────────────────────── Exercises ─────────────────────────────
export interface Exercise {
  n: string                  // display name
  p: MuscleId[]              // primary muscles (sub-head granular)
  s: MuscleId[]              // secondary muscles
  req: EquipmentId[]         // equipment requirement (ANY of these is enough)
  sets: number
  r: number                  // default reps
  w?: number                 // default starting weight (kg, optional — bodyweight if omitted)
  gif?: string               // image/GIF URL (Free Exercise DB or similar)
  cues?: string[]            // short form cues
  level?: "beginner" | "intermediate" | "advanced"
  category?: "compound" | "isolation" | "cardio" | "stretch"
}

// Exercise with its key bundled (used at runtime in the active workout).
// `_uid` is a stable instance ID — same exercise can appear multiple times in a
// workout, so each slot gets its own UID for drag-and-drop tracking.
export interface ExerciseWithId extends Exercise { id: string; _uid?: string }

export type ExerciseDict = Record<string, Exercise>

// ───────────────────────────── Routines ─────────────────────────────
export type RoutineId = string // built-ins: "sl" | "ct" | "bb" — user-created get unique ids

export interface Routine {
  id: RoutineId
  name: string
  tags: string[]
  exerciseIds: string[]      // ordered exercise ids drawn from EX
  daysPerWeek?: number
  isCustom?: boolean
}

// ───────────────────────────── Gyms ─────────────────────────────
export interface Gym {
  id: string
  name: string
  emoji: string
  eq: EquipmentId[]
  notes?: string
}

// ───────────────────────────── Workout / sets ─────────────────────────────
export interface SetLog {
  weight: number
  reps: number
  done: boolean
  rpe?: number
}

export interface ActiveWorkout {
  gymId: string
  routineId: RoutineId
  startTime: number
  exercises: ExerciseWithId[]
  sets: Record<string, SetLog>  // key: `${exerciseIndex}_${setIndex}`
  setCounts?: Record<number, number>  // override default ex.sets per index — lets users add extra sets mid-workout
  customName?: string                 // user-typed name (overrides routine.name in UI)
  splitId?: string                    // which split was picked when starting
  notes?: string
}

// ───────────────────────────── Splits (training programs) ─────────────────────────────
// A Split groups multiple Routines into a coherent weekly program.
export interface Split {
  id: string
  name: string
  desc: string
  daysPerWeek: number
  routineIds: RoutineId[]   // ordered list of the routines in this split
}

// ───────────────────────────── History ─────────────────────────────
export interface HistoryExerciseLog {
  id: string
  n: string
  sets: SetLog[]
}

export interface HistoryEntry {
  id: string
  date: string                // ISO timestamp
  routine?: string            // display name
  routineId?: RoutineId
  gymId?: string
  dur: number                 // seconds
  vol: number                 // kg total
  prsCount?: number
  exs?: string[]              // short list of exercise names for the chip preview
  details?: HistoryExerciseLog[]  // full per-set detail (NEW — needed for log detail view)
  notes?: string
  sample?: boolean            // true for seeded sample rows; cleared on first real log
}

// ───────────────────────────── PRs ─────────────────────────────
export interface PR {
  n?: string
  w: number
  r: number
  date: string
  e1rm?: number
  exerciseId?: string
  sample?: boolean
}

// ───────────────────────────── App state ─────────────────────────────
export interface AppState {
  isFirstTime: boolean
  gyms: Gym[]
  activeGymId: string
  activeRoutineId: RoutineId
  customRoutines: Routine[]      // user-created routines (built-ins live in data.ts)
  history: HistoryEntry[]
  prs: Record<string, PR>        // keyed by exerciseId
  current: ActiveWorkout | null  // active in-progress workout (transient)
  user?: { id: string; email?: string }  // current Supabase user
}
