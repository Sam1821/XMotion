"use client"

// SamMotion — Supabase-backed per-user store.
// State shape mirrors the original localStorage version (so existing screens compile),
// but persistence goes to Supabase tables filtered by auth.uid() via RLS.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { ALL_EQ_IDS, EX } from "./data"
import { calcE1RM, recomputePRsFromHistory } from "./helpers"
import type {
  ActiveWorkout, AppState, EquipmentId, ExerciseWithId, Gym, HistoryEntry, PR, Routine, RoutineId,
} from "./types"

// localStorage key for the active (in-progress) workout — restored on app launch
// so that backgrounding the app doesn't lose progress.
const ACTIVE_WORKOUT_LS_KEY = "xmotion.active-workout.v1"

function genUid(): string {
  return Math.random().toString(36).slice(2, 11)
}

// Stamp every exercise in a workout with a stable instance id (idempotent).
function ensureUids(w: ActiveWorkout): ActiveWorkout {
  return {
    ...w,
    exercises: w.exercises.map((e) => (e._uid ? e : { ...e, _uid: genUid() })),
  }
}

// ─────── Default state (used until first Supabase load) ───────
const defaultGym: Gym = {
  id: "g_default",
  name: "My Gym",
  emoji: "🏠",
  eq: ALL_EQ_IDS.slice(0, 14),  // sensible default loadout
}

function makeDefaultState(): AppState {
  return {
    isFirstTime: true,
    gyms: [defaultGym],
    activeGymId: defaultGym.id,
    activeRoutineId: "sl",
    customRoutines: [],
    history: [],
    prs: {},
    current: null,
  }
}

// ─────── Context ───────
interface StoreCtx {
  state: AppState
  loading: boolean
  error: string | null
  // gym
  selectGym: (id: string) => void
  toggleEquipment: (id: EquipmentId) => void
  addGym: (g: Gym) => void
  updateGym: (id: string, patch: Partial<Gym>) => void
  deleteGym: (id: string) => void
  // routine
  setActiveRoutine: (id: RoutineId) => void
  addCustomRoutine: (r: Routine) => void
  updateCustomRoutine: (id: RoutineId, patch: Partial<Routine>) => void
  deleteCustomRoutine: (id: RoutineId) => void
  // workout
  startWorkout: (w: ActiveWorkout) => void
  updateCurrent: (fn: (prev: ActiveWorkout) => ActiveWorkout) => void
  cancelWorkout: () => void
  finishWorkout: (summary: { dur: number; vol: number; prsCount: number; newPRs: Record<string, PR & { e1rm: number }> }) => void
  // workout exercise mutators
  reorderExercise: (from: number, to: number) => void
  removeExercise: (index: number) => void
  replaceExercise: (index: number, newExerciseId: string) => void
  addExerciseToWorkout: (exerciseId: string) => void
  addSetToExercise: (index: number) => void
  removeSetFromExercise: (index: number) => void
  setWorkoutName: (name: string) => void
  setWorkoutNotes: (notes: string) => void
  saveCurrentAsRoutine: (name: string) => void
  // history
  deleteSession: (id: string) => void
  updateSession: (id: string, patch: Partial<HistoryEntry>) => void
  // auth
  signOut: () => Promise<void>
}

const Ctx = createContext<StoreCtx | null>(null)

export function useStore(): StoreCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error("useStore must be used within StoreProvider")
  return c
}

// ─────── Provider ───────
export function StoreProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<AppState>(makeDefaultState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userIdRef = useRef<string | null>(null)

  // Sync helpers — write-through to Supabase. Each call is fire-and-forget; UI updates
  // optimistically via setState. Failures surface to `error` but don't block UX.
  const upsertGym = useCallback(async (g: Gym) => {
    const uid = userIdRef.current
    if (!uid) return
    const { error } = await supabase.from("gyms").upsert({
      id: g.id, user_id: uid, name: g.name, emoji: g.emoji, equipment: g.eq, notes: g.notes ?? null,
    })
    if (error) setError(error.message)
  }, [supabase])

  const removeGym = useCallback(async (id: string) => {
    const { error } = await supabase.from("gyms").delete().eq("id", id)
    if (error) setError(error.message)
  }, [supabase])

  const upsertRoutine = useCallback(async (r: Routine) => {
    const uid = userIdRef.current
    if (!uid) return
    const { error } = await supabase.from("routines").upsert({
      id: r.id, user_id: uid, name: r.name, tags: r.tags, exercise_ids: r.exerciseIds,
      days_per_week: r.daysPerWeek ?? null, is_custom: true,
    })
    if (error) setError(error.message)
  }, [supabase])

  const removeRoutine = useCallback(async (id: string) => {
    const { error } = await supabase.from("routines").delete().eq("id", id)
    if (error) setError(error.message)
  }, [supabase])

  const upsertHistory = useCallback(async (h: HistoryEntry) => {
    const uid = userIdRef.current
    if (!uid) return
    const { error } = await supabase.from("history").upsert({
      id: h.id, user_id: uid, date: h.date, routine: h.routine ?? null, routine_id: h.routineId ?? null,
      gym_id: h.gymId ?? null, dur: h.dur, vol: h.vol, prs_count: h.prsCount ?? 0,
      exs: h.exs ?? [], details: h.details ?? null, notes: h.notes ?? null,
    })
    if (error) setError(error.message)
  }, [supabase])

  const removeHistory = useCallback(async (id: string) => {
    const { error } = await supabase.from("history").delete().eq("id", id)
    if (error) setError(error.message)
  }, [supabase])

  const upsertPR = useCallback(async (exerciseId: string, pr: PR) => {
    const uid = userIdRef.current
    if (!uid) return
    const { error } = await supabase.from("prs").upsert({
      user_id: uid, exercise_id: exerciseId, n: pr.n ?? null,
      w: pr.w, r: pr.r, e1rm: pr.e1rm ?? null, date: pr.date,
    })
    if (error) setError(error.message)
  }, [supabase])

  const upsertProfile = useCallback(async (patch: Partial<Pick<AppState, "activeGymId" | "activeRoutineId" | "isFirstTime">>) => {
    const uid = userIdRef.current
    if (!uid) return
    const { error } = await supabase.from("profiles").upsert({
      user_id: uid,
      active_gym_id: patch.activeGymId ?? state.activeGymId,
      active_routine_id: patch.activeRoutineId ?? state.activeRoutineId,
      is_first_time: patch.isFirstTime ?? state.isFirstTime,
    })
    if (error) setError(error.message)
  }, [supabase, state.activeGymId, state.activeRoutineId, state.isFirstTime])

  // ─────── Initial load ───────
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (alive) setLoading(false)
        return
      }
      userIdRef.current = user.id

      const [gymsR, routinesR, historyR, prsR, profileR] = await Promise.all([
        supabase.from("gyms").select("*").eq("user_id", user.id),
        supabase.from("routines").select("*").eq("user_id", user.id),
        supabase.from("history").select("*").eq("user_id", user.id).order("date", { ascending: false }),
        supabase.from("prs").select("*").eq("user_id", user.id),
        supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      ])

      if (!alive) return

      const gyms: Gym[] = (gymsR.data || []).map((row: any) => ({
        id: row.id, name: row.name, emoji: row.emoji, eq: row.equipment || [], notes: row.notes ?? undefined,
      }))
      const customRoutines: Routine[] = (routinesR.data || []).map((row: any) => ({
        id: row.id, name: row.name, tags: row.tags || [], exerciseIds: row.exercise_ids || [],
        daysPerWeek: row.days_per_week ?? undefined, isCustom: true,
      }))
      const history: HistoryEntry[] = (historyR.data || []).map((row: any) => ({
        id: row.id, date: row.date, routine: row.routine ?? undefined, routineId: row.routine_id ?? undefined,
        gymId: row.gym_id ?? undefined, dur: row.dur || 0, vol: row.vol || 0, prsCount: row.prs_count || 0,
        exs: row.exs || [], details: row.details ?? undefined, notes: row.notes ?? undefined,
      }))
      const prs: Record<string, PR> = {}
      ;(prsR.data || []).forEach((row: any) => {
        prs[row.exercise_id] = {
          n: row.n ?? undefined, w: row.w, r: row.r, date: row.date, e1rm: row.e1rm ?? undefined, exerciseId: row.exercise_id,
        }
      })

      const profile = profileR.data
      const isFirstTime = profile ? profile.is_first_time : history.length === 0

      // Bootstrap: if user has no gym yet (brand-new account), seed a default and persist.
      if (gyms.length === 0) {
        gyms.push({ ...defaultGym })
        await supabase.from("gyms").insert({
          id: defaultGym.id, user_id: user.id, name: defaultGym.name, emoji: defaultGym.emoji, equipment: defaultGym.eq,
        })
      }

      setState((prev) => ({
        ...prev,
        user: { id: user.id, email: user.email ?? undefined },
        gyms, customRoutines, history, prs,
        activeGymId: profile?.active_gym_id || gyms[0]?.id || defaultGym.id,
        activeRoutineId: profile?.active_routine_id || "sl",
        isFirstTime,
      }))
      setLoading(false)
    })().catch((e: unknown) => {
      if (alive) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [supabase])

  // ─────── Mutators ───────
  const selectGym = useCallback((id: string) => {
    setState((s) => ({ ...s, activeGymId: id }))
    upsertProfile({ activeGymId: id })
  }, [upsertProfile])

  const toggleEquipment = useCallback((eqId: EquipmentId) => {
    setState((s) => {
      const gym = s.gyms.find((g) => g.id === s.activeGymId)
      if (!gym) return s
      const has = gym.eq.includes(eqId)
      const nextGym: Gym = { ...gym, eq: has ? gym.eq.filter((x) => x !== eqId) : [...gym.eq, eqId] }
      upsertGym(nextGym)
      return { ...s, gyms: s.gyms.map((g) => (g.id === gym.id ? nextGym : g)) }
    })
  }, [upsertGym])

  const addGym = useCallback((g: Gym) => {
    setState((s) => ({ ...s, gyms: [...s.gyms, g], activeGymId: g.id }))
    upsertGym(g)
    upsertProfile({ activeGymId: g.id })
  }, [upsertGym, upsertProfile])

  const updateGym = useCallback((id: string, patch: Partial<Gym>) => {
    setState((s) => {
      const gym = s.gyms.find((g) => g.id === id)
      if (!gym) return s
      const next = { ...gym, ...patch }
      upsertGym(next)
      return { ...s, gyms: s.gyms.map((g) => (g.id === id ? next : g)) }
    })
  }, [upsertGym])

  const deleteGym = useCallback((id: string) => {
    setState((s) => {
      if (s.gyms.length <= 1) return s  // never leave the user with zero gyms
      const remaining = s.gyms.filter((g) => g.id !== id)
      const newActive = s.activeGymId === id ? remaining[0].id : s.activeGymId
      removeGym(id)
      if (newActive !== s.activeGymId) upsertProfile({ activeGymId: newActive })
      return { ...s, gyms: remaining, activeGymId: newActive }
    })
  }, [removeGym, upsertProfile])

  const setActiveRoutine = useCallback((id: RoutineId) => {
    setState((s) => ({ ...s, activeRoutineId: id }))
    upsertProfile({ activeRoutineId: id })
  }, [upsertProfile])

  const addCustomRoutine = useCallback((r: Routine) => {
    const withFlag = { ...r, isCustom: true }
    setState((s) => ({ ...s, customRoutines: [...s.customRoutines, withFlag] }))
    upsertRoutine(withFlag)
  }, [upsertRoutine])

  const updateCustomRoutine = useCallback((id: RoutineId, patch: Partial<Routine>) => {
    setState((s) => {
      const r = s.customRoutines.find((x) => x.id === id)
      if (!r) return s
      const next = { ...r, ...patch }
      upsertRoutine(next)
      return { ...s, customRoutines: s.customRoutines.map((x) => (x.id === id ? next : x)) }
    })
  }, [upsertRoutine])

  const deleteCustomRoutine = useCallback((id: RoutineId) => {
    setState((s) => ({ ...s, customRoutines: s.customRoutines.filter((r) => r.id !== id) }))
    removeRoutine(id)
  }, [removeRoutine])

  const startWorkout = useCallback((w: ActiveWorkout) => {
    setState((s) => ({ ...s, current: ensureUids(w) }))
  }, [])

  const updateCurrent = useCallback((fn: (prev: ActiveWorkout) => ActiveWorkout) => {
    setState((s) => (s.current ? { ...s, current: fn(s.current) } : s))
  }, [])

  // Restore an in-progress workout from localStorage on first mount.
  // Runs once; never overwrites an already-loaded workout from Supabase.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(ACTIVE_WORKOUT_LS_KEY)
      if (!raw) return
      const restored = JSON.parse(raw) as ActiveWorkout
      if (!restored || !restored.exercises) return
      setState((s) => (s.current ? s : { ...s, current: ensureUids(restored) }))
    } catch {
      // bad JSON / quota errors — ignore, just don't restore.
    }
  }, [])

  // Persist active workout to localStorage on every change. Cleared on finish/cancel.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (state.current) {
        localStorage.setItem(ACTIVE_WORKOUT_LS_KEY, JSON.stringify(state.current))
      } else {
        localStorage.removeItem(ACTIVE_WORKOUT_LS_KEY)
      }
    } catch {
      // Quota errors etc — non-fatal.
    }
  }, [state.current])

  const cancelWorkout = useCallback(() => {
    setState((s) => ({ ...s, current: null }))
  }, [])

  const finishWorkout = useCallback((summary: { dur: number; vol: number; prsCount: number; newPRs: Record<string, PR & { e1rm: number }> }) => {
    setState((s) => {
      if (!s.current) return s

      const exs: string[] = s.current.exercises.map((e) => e.n).slice(0, 4)
      const details = s.current.exercises.map((ex, ei) => {
        const sets = Array.from({ length: ex.sets || 3 }).map((_, si) => {
          return s.current!.sets[`${ei}_${si}`] || { weight: 0, reps: 0, done: false }
        })
        return { id: ex.id, n: ex.n, sets }
      })

      const entry: HistoryEntry = {
        id: "h_" + Date.now(),
        date: new Date().toISOString(),
        routineId: s.current.routineId,
        gymId: s.current.gymId,
        dur: summary.dur,
        vol: Math.round(summary.vol),
        prsCount: summary.prsCount,
        exs,
        details,
      }

      const nextPRs: Record<string, PR> = { ...s.prs }
      Object.entries(summary.newPRs).forEach(([id, pr]) => {
        nextPRs[id] = { ...pr, exerciseId: id }
        upsertPR(id, nextPRs[id])
      })

      upsertHistory(entry)
      if (s.isFirstTime) upsertProfile({ isFirstTime: false })

      return {
        ...s,
        current: null,
        history: [entry, ...s.history],
        prs: nextPRs,
        isFirstTime: false,
      }
    })
  }, [upsertHistory, upsertPR, upsertProfile])

  // Wipe stale PRs in Supabase and write the new computed set. Keeps the prs table clean.
  const syncPRs = useCallback(async (newPRs: Record<string, PR>) => {
    const uid = userIdRef.current
    if (!uid) return
    // Replace strategy: delete-all + bulk upsert.
    await supabase.from("prs").delete().eq("user_id", uid)
    const rows = Object.entries(newPRs).map(([exerciseId, pr]) => ({
      user_id: uid, exercise_id: exerciseId, n: pr.n ?? null,
      w: pr.w, r: pr.r, e1rm: pr.e1rm ?? null, date: pr.date,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from("prs").upsert(rows)
      if (error) setError(error.message)
    }
  }, [supabase])

  const deleteSession = useCallback((id: string) => {
    setState((s) => {
      const remaining = s.history.filter((h) => h.id !== id)
      const newPRs = recomputePRsFromHistory(remaining)
      removeHistory(id)
      syncPRs(newPRs)
      return { ...s, history: remaining, prs: newPRs }
    })
  }, [removeHistory, syncPRs])

  const updateSession = useCallback((id: string, patch: Partial<HistoryEntry>) => {
    setState((s) => {
      const h = s.history.find((x) => x.id === id)
      if (!h) return s
      const next = { ...h, ...patch }
      // Recompute volume from details if details were edited.
      if (patch.details) {
        let vol = 0
        patch.details.forEach((d) => d.sets.forEach((set) => { if (set.done) vol += set.weight * set.reps }))
        next.vol = Math.round(vol)
      }
      const newHistory = s.history.map((x) => (x.id === id ? next : x))
      const newPRs = recomputePRsFromHistory(newHistory)
      upsertHistory(next)
      syncPRs(newPRs)
      return { ...s, history: newHistory, prs: newPRs }
    })
  }, [upsertHistory, syncPRs])

  // ─────── Active-workout exercise mutators ───────
  const reorderExercise = useCallback((from: number, to: number) => {
    setState((s) => {
      if (!s.current) return s
      const exs = [...s.current.exercises]
      if (from < 0 || to < 0 || from >= exs.length || to >= exs.length) return s
      const [moved] = exs.splice(from, 1)
      exs.splice(to, 0, moved)
      // Reindex set keys: sets are keyed by `${exerciseIndex}_${setIndex}` so moves shuffle them.
      const newSets: Record<string, typeof s.current.sets[string]> = {}
      Object.entries(s.current.sets).forEach(([k, v]) => {
        const [eiStr, siStr] = k.split("_")
        const ei = parseInt(eiStr, 10)
        let newEi = ei
        if (ei === from) newEi = to
        else if (from < to && ei > from && ei <= to) newEi = ei - 1
        else if (from > to && ei >= to && ei < from) newEi = ei + 1
        newSets[`${newEi}_${siStr}`] = v
      })
      return { ...s, current: { ...s.current, exercises: exs, sets: newSets } }
    })
  }, [])

  const removeExercise = useCallback((index: number) => {
    setState((s) => {
      if (!s.current) return s
      const exs = s.current.exercises.filter((_, i) => i !== index)
      const newSets: Record<string, typeof s.current.sets[string]> = {}
      Object.entries(s.current.sets).forEach(([k, v]) => {
        const [eiStr, siStr] = k.split("_")
        const ei = parseInt(eiStr, 10)
        if (ei === index) return
        const newEi = ei > index ? ei - 1 : ei
        newSets[`${newEi}_${siStr}`] = v
      })
      return { ...s, current: { ...s.current, exercises: exs, sets: newSets } }
    })
  }, [])

  const replaceExercise = useCallback((index: number, newExerciseId: string) => {
    setState((s) => {
      if (!s.current) return s
      const def = EX[newExerciseId]
      if (!def) return s
      const replacement: ExerciseWithId = { id: newExerciseId, _uid: genUid(), ...def }
      const exs = s.current.exercises.map((e, i) => (i === index ? replacement : e))
      // Drop any previously logged sets for this slot since exercise changed.
      const newSets: Record<string, typeof s.current.sets[string]> = {}
      Object.entries(s.current.sets).forEach(([k, v]) => {
        const [eiStr] = k.split("_")
        if (parseInt(eiStr, 10) !== index) newSets[k] = v
      })
      return { ...s, current: { ...s.current, exercises: exs, sets: newSets } }
    })
  }, [])

  const addExerciseToWorkout = useCallback((exerciseId: string) => {
    setState((s) => {
      if (!s.current) return s
      const def = EX[exerciseId]
      if (!def) return s
      return {
        ...s,
        current: {
          ...s.current,
          exercises: [...s.current.exercises, { id: exerciseId, _uid: genUid(), ...def }],
        },
      }
    })
  }, [])

  const addSetToExercise = useCallback((index: number) => {
    setState((s) => {
      if (!s.current) return s
      const ex = s.current.exercises[index]
      if (!ex) return s
      const counts = { ...(s.current.setCounts || {}) }
      const current = counts[index] ?? (ex.sets || 3)
      counts[index] = current + 1
      return { ...s, current: { ...s.current, setCounts: counts } }
    })
  }, [])

  const removeSetFromExercise = useCallback((index: number) => {
    setState((s) => {
      if (!s.current) return s
      const ex = s.current.exercises[index]
      if (!ex) return s
      const counts = { ...(s.current.setCounts || {}) }
      const current = counts[index] ?? (ex.sets || 3)
      if (current <= 1) return s  // never go below 1 set
      counts[index] = current - 1
      // Drop the trailing set log so totals are consistent.
      const newSets = { ...s.current.sets }
      delete newSets[`${index}_${current - 1}`]
      return { ...s, current: { ...s.current, setCounts: counts, sets: newSets } }
    })
  }, [])

  const setWorkoutName = useCallback((name: string) => {
    setState((s) => (s.current ? { ...s, current: { ...s.current, customName: name } } : s))
  }, [])

  const setWorkoutNotes = useCallback((notes: string) => {
    setState((s) => (s.current ? { ...s, current: { ...s.current, notes } } : s))
  }, [])

  const saveCurrentAsRoutine = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setState((s) => {
      if (!s.current || s.current.exercises.length === 0) return s
      const newRoutine: Routine = {
        id: "r_" + Date.now(),
        name: trimmed,
        tags: [],
        exerciseIds: s.current.exercises.map((e) => e.id),
        daysPerWeek: 1,
        isCustom: true,
      }
      upsertRoutine(newRoutine)
      return { ...s, customRoutines: [...s.customRoutines, newRoutine] }
    })
  }, [upsertRoutine])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    window.location.href = "/auth/login"
  }, [supabase])

  // Re-export calcE1RM to keep the workout screen happy without touching its imports.
  void calcE1RM

  const value: StoreCtx = {
    state, loading, error,
    selectGym, toggleEquipment, addGym, updateGym, deleteGym,
    setActiveRoutine, addCustomRoutine, updateCustomRoutine, deleteCustomRoutine,
    startWorkout, updateCurrent, cancelWorkout, finishWorkout,
    reorderExercise, removeExercise, replaceExercise, addExerciseToWorkout,
    addSetToExercise, removeSetFromExercise, setWorkoutName, setWorkoutNotes, saveCurrentAsRoutine,
    deleteSession, updateSession,
    signOut,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
