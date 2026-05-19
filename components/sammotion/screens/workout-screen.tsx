"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ROUTINES } from "@/lib/sammotion/data"
import { getActiveGym } from "@/lib/sammotion/helpers"
import { MuscleSVG } from "@/lib/sammotion/muscle-svg"
import { useStore } from "@/lib/sammotion/store"
import type { ExerciseWithId, SetLog } from "@/lib/sammotion/types"

function capitalize(m: string) {
  return m.charAt(0).toUpperCase() + m.slice(1)
}

export function WorkoutScreen({
  active,
  onStartWorkout,
  onFinish,
  onAddExercise,
  onReplaceExercise,
  timerSec,
}: {
  active: boolean
  onStartWorkout: () => void
  onFinish: () => void
  onAddExercise: () => void
  onReplaceExercise: (index: number) => void
  timerSec: number
}) {
  const {
    state,
    updateCurrent,
    reorderExercise,
    removeExercise,
    addSetToExercise,
    removeSetFromExercise,
    setWorkoutName,
    setWorkoutNotes,
  } = useStore()
  const current = state.current
  const [openIdx, setOpenIdx] = useState<number>(0)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1)

  useEffect(() => {
    if (!current) {
      setOpenIdx(0)
      return
    }
    if (openIdx >= current.exercises.length) setOpenIdx(0)
  }, [current, openIdx])

  // ─── DnD setup ───
  const sensors = useSensors(
    // Pointer activation requires 5px drag distance to avoid hijacking taps on inner buttons.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Touch activation: a 200ms long-press then 5px drag — prevents accidental drags while scrolling.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active: a, over } = event
    if (!over || a.id === over.id || !current) return
    const from = current.exercises.findIndex((e) => e._uid === a.id)
    const to = current.exercises.findIndex((e) => e._uid === over.id)
    if (from < 0 || to < 0) return
    reorderExercise(from, to)
  }

  // ─── Set helpers ───
  function setKey(ei: number, si: number) {
    return `${ei}_${si}`
  }
  function getSet(ei: number, si: number, ex: ExerciseWithId): SetLog {
    if (!current) return { weight: ex.w || 0, reps: ex.r || 5, done: false }
    return current.sets[setKey(ei, si)] || { weight: ex.w || 0, reps: ex.r || 5, done: false }
  }
  function adjust(ei: number, si: number, ex: ExerciseWithId, field: "weight" | "reps", delta: number) {
    updateCurrent((prev) => {
      const k = setKey(ei, si)
      const existing = prev.sets[k] || { weight: ex.w || 0, reps: ex.r || 5, done: false }
      let next = existing[field] + delta
      if (field === "weight") next = Math.max(0, Math.round(next * 2) / 2)
      else next = Math.max(0, Math.round(next))
      return { ...prev, sets: { ...prev.sets, [k]: { ...existing, [field]: next } } }
    })
  }
  function toggleDone(ei: number, si: number, ex: ExerciseWithId) {
    updateCurrent((prev) => {
      const k = setKey(ei, si)
      const existing = prev.sets[k] || { weight: ex.w || 0, reps: ex.r || 5, done: false }
      return { ...prev, sets: { ...prev.sets, [k]: { ...existing, done: !existing.done } } }
    })
  }

  function handleDelete(i: number) {
    if (confirmDeleteIdx === i) {
      removeExercise(i)
      setConfirmDeleteIdx(-1)
    } else {
      setConfirmDeleteIdx(i)
      setTimeout(() => setConfirmDeleteIdx((cur) => (cur === i ? -1 : cur)), 3000)
    }
  }

  const routine = current ? ROUTINES.find((r) => r.id === current.routineId) : null
  const gym = current ? getActiveGym(state) : null

  const totalSets = useMemo(() => {
    if (!current) return 0
    return current.exercises.reduce((a, e, i) => a + (current.setCounts?.[i] ?? (e.sets || 3)), 0)
  }, [current])
  const doneSets = useMemo(() => {
    if (!current) return 0
    return Object.values(current.sets).filter((s) => s.done).length
  }, [current])
  const progressPct = totalSets ? Math.min(100, Math.round((doneSets / totalSets) * 100)) : 0
  const exDone =
    current && totalSets
      ? Math.min(current.exercises.length, Math.floor(doneSets / (totalSets / current.exercises.length || 1)))
      : 0

  const mm = String(Math.floor(timerSec / 60)).padStart(2, "0")
  const ss = String(timerSec % 60).padStart(2, "0")

  return (
    <section className={`sm-scr ${active ? "on" : ""}`} aria-label="Workout">
      <div className="woHdr">
        <div className="row jb">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t10 w7 c2 upper">In Progress</div>
            {current && editingName ? (
              <input
                autoFocus
                className="inp"
                style={{ marginTop: 4, padding: "6px 10px", fontSize: 16, fontWeight: 800, letterSpacing: "-.3px" }}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => { setWorkoutName(nameDraft.trim()); setEditingName(false) }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { setWorkoutName(nameDraft.trim()); setEditingName(false) }
                  if (e.key === "Escape") setEditingName(false)
                }}
                maxLength={40}
              />
            ) : (
              <div
                className="t17 w9 mt4"
                style={{ letterSpacing: "-.4px", cursor: current ? "pointer" : "default" }}
                onClick={() => {
                  if (!current) return
                  setNameDraft(current.customName || routine?.name || "Workout")
                  setEditingName(true)
                }}
                title={current ? "Tap to rename" : undefined}
              >
                {current ? (current.customName || routine?.name || "Workout") : "—"}
                {current ? <span className="t10 c3" style={{ marginLeft: 6, fontWeight: 500 }}>✎</span> : null}
              </div>
            )}
            <div className="t11 c2 mt4">{current && gym ? gym.name : "—"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="row g6" style={{ justifyContent: "flex-end" }}>
              <div className="liveDot" />
              <span className="t13 w7 cg mono">{mm}:{ss}</span>
            </div>
            <div className="t10 c2 mt4">
              {current ? `${exDone} / ${current.exercises.length} exercises` : "0 / 0 exercises"}
            </div>
          </div>
        </div>
        <div className="pbarTrack">
          <div className="pbarFill" style={{ width: progressPct + "%" }} />
        </div>
      </div>

      <div className="tipBar">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth={2.2}>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
        <span className="t13 cg w7">Drag </span>
        <span className="t13 c2">
          {current
            ? `the ≡ handle to reorder · tap ↻ to replace · ✕ to remove (twice to confirm)`
            : "select a workout to begin"}
        </span>
      </div>

      {!current ? (
        <div className="sm-empty">
          <div className="t17 w7 c2">No active workout</div>
          <div className="t13 c2 mt8">Go to Home and tap &ldquo;Start Workout&rdquo;</div>
          <button type="button" className="btnP mt16" onClick={onStartWorkout} style={{ maxWidth: 260 }}>
            Start Workout →
          </button>
        </div>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={current.exercises.map((e) => e._uid || `noid-${current.exercises.indexOf(e)}`)}
              strategy={verticalListSortingStrategy}
            >
              <div>
                {current.exercises.map((ex, i) => (
                  <SortableExerciseCard
                    key={ex._uid || `noid-${i}`}
                    uid={ex._uid || `noid-${i}`}
                    ex={ex}
                    index={i}
                    isOpen={i === openIdx}
                    onToggleOpen={() => setOpenIdx(i === openIdx ? -1 : i)}
                    onReplace={() => onReplaceExercise(i)}
                    onDelete={() => handleDelete(i)}
                    confirmingDelete={confirmDeleteIdx === i}
                    setCount={current.setCounts?.[i] ?? (ex.sets || 3)}
                    onAddSet={() => addSetToExercise(i)}
                    onRemoveSet={() => removeSetFromExercise(i)}
                    getSet={(si) => getSet(i, si, ex)}
                    onAdjust={(si, field, delta) => adjust(i, si, ex, field, delta)}
                    onToggleSetDone={(si) => toggleDone(i, si, ex)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <button type="button" className="addExBtn" onClick={onAddExercise}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="t13 w6">Add Exercise</span>
          </button>

          {/* Workout-level notes / remarks */}
          <div style={{ padding: "0 16px 12px" }}>
            <div className="t10 w7 c2 upper mb8" style={{ letterSpacing: ".6px" }}>Notes</div>
            <textarea
              className="inp"
              value={current.notes || ""}
              onChange={(e) => setWorkoutNotes(e.target.value)}
              placeholder="How did it feel? Energy, pain points, observations…"
              rows={3}
              style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }}
              maxLength={500}
            />
          </div>

          <div style={{ padding: "0 16px 8px" }}>
            <button
              type="button"
              className="btnP"
              style={{ background: "var(--card2)", color: "var(--t2)", boxShadow: "none", border: "1px solid var(--border)" }}
              onClick={onFinish}
            >
              Finish Workout
            </button>
          </div>
        </>
      )}

      <div className="bspace" />
    </section>
  )
}

// ─── Sortable exercise card (extracted because useSortable can only be called from a child component) ───
function SortableExerciseCard({
  uid,
  ex,
  index,
  isOpen,
  onToggleOpen,
  onReplace,
  onDelete,
  confirmingDelete,
  setCount,
  onAddSet,
  onRemoveSet,
  getSet,
  onAdjust,
  onToggleSetDone,
}: {
  uid: string
  ex: ExerciseWithId
  index: number
  isOpen: boolean
  onToggleOpen: () => void
  onReplace: () => void
  onDelete: () => void
  confirmingDelete: boolean
  setCount: number
  onAddSet: () => void
  onRemoveSet: () => void
  getSet: (si: number) => SetLog
  onAdjust: (si: number, field: "weight" | "reps", delta: number) => void
  onToggleSetDone: (si: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : "auto",
    position: "relative",
  }
  const primaryLabels = (ex.p || []).map(capitalize).join(" · ")

  return (
    <div ref={setNodeRef} style={style} className={`exCard ${isOpen ? "act" : ""}`}>
      <div className="exHdr">
        {/* Drag handle */}
        <button
          type="button"
          className="dragHandle"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <line x1="4" y1="8" x2="20" y2="8" />
            <line x1="4" y1="16" x2="20" y2="16" />
          </svg>
        </button>

        <div className="row g8 f1" role="button" tabIndex={0} onClick={onToggleOpen} style={{ minWidth: 0 }}>
          <div className="exNum">{index + 1}</div>
          <div className="col f1 g4" style={{ minWidth: 0 }}>
            <div className="row g8" style={{ minWidth: 0 }}>
              <span className="t15 w7" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.n}</span>
              <span className="muscleTag">{primaryLabels}</span>
            </div>
            <span className="t11 c2">{setCount} sets × {ex.r} reps{ex.w ? ` · ${ex.w} kg` : ""}</span>
          </div>
        </div>

        {/* Inline action buttons — always visible, no hidden menu */}
        <button
          type="button"
          className="exActionBtn"
          onClick={(e) => { e.stopPropagation(); onReplace() }}
          aria-label="Replace exercise"
          title="Replace"
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <polyline points="23 20 23 14 17 14" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
        <button
          type="button"
          className={`exActionBtn ${confirmingDelete ? "danger" : ""}`}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          aria-label={confirmingDelete ? "Tap again to confirm delete" : "Delete exercise"}
          title={confirmingDelete ? "Tap again to confirm" : "Remove"}
        >
          {confirmingDelete ? (
            <span style={{ fontSize: 10, fontWeight: 800 }}>?</span>
          ) : (
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="exActionBtn"
          onClick={(e) => { e.stopPropagation(); onToggleOpen() }}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <svg
            className={`chevron ${isOpen ? "open" : ""}`}
            width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div className="exBody">
        <div className="mmSec">
          <MuscleSVG primary={ex.p || []} secondary={ex.s || []} />
          <div className="col f1">
            <div className="t10 w7 c2 upper mb8" style={{ letterSpacing: ".6px" }}>Target Muscles</div>
            <div className="mmLegend">
              {(ex.p || []).map((m) => (
                <div key={`p-${m}`} className="row g8">
                  <div className="mmDot" style={{ background: "var(--orange)", boxShadow: "0 0 5px var(--orange)" }} />
                  <div className="col g4">
                    <span className="t11 w6">{capitalize(m)}</span>
                    <span className="t10 c2">Primary</span>
                  </div>
                </div>
              ))}
              {(ex.s || []).slice(0, 2).map((m) => (
                <div key={`s-${m}`} className="row g8">
                  <div className="mmDot" style={{ background: "var(--green)", boxShadow: "0 0 5px var(--green)" }} />
                  <div className="col g4">
                    <span className="t11 w6">{capitalize(m)}</span>
                    <span className="t10 c2">Secondary</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="setLogger">
          <div className="logHdr">
            <span className="t10 c3 w7" style={{ width: 20 }}>Set</span>
            <span className="t10 c3 w7 f1" style={{ textAlign: "center" }}>Weight (kg)</span>
            <span className="t10 c3 w7 f1" style={{ textAlign: "center" }}>Reps</span>
            <div style={{ width: 40 }} />
          </div>
          {Array.from({ length: setCount }).map((_, si) => {
            const s = getSet(si)
            return (
              <div key={si} className="logRow">
                <span className="t11 w7 c3" style={{ width: 20 }}>{si + 1}</span>
                <div className="spinner">
                  <button type="button" className="spBtn" onClick={() => onAdjust(si, "weight", -2.5)}>−</button>
                  <div className="spVal mono">{s.weight % 1 === 0 ? s.weight : s.weight.toFixed(1)}</div>
                  <div className="spUnit">kg</div>
                  <button type="button" className="spBtn" onClick={() => onAdjust(si, "weight", 2.5)}>+</button>
                </div>
                <div className="spinner">
                  <button type="button" className="spBtn" onClick={() => onAdjust(si, "reps", -1)}>−</button>
                  <div className="spVal mono">{s.reps}</div>
                  <div className="spUnit">reps</div>
                  <button type="button" className="spBtn" onClick={() => onAdjust(si, "reps", 1)}>+</button>
                </div>
                <button
                  type="button"
                  className={`chkBtn ${s.done ? "done" : ""}`}
                  onClick={() => onToggleSetDone(si)}
                  aria-label={s.done ? "Mark incomplete" : "Mark complete"}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={s.done ? "var(--green)" : "var(--t3)"} strokeWidth={2.8}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            )
          })}
          <div className="row g8" style={{ justifyContent: "center", marginTop: 8 }}>
            <button type="button" className="bdg" onClick={onRemoveSet} disabled={setCount <= 1}>− Remove set</button>
            <button type="button" className="bdg bdo" onClick={onAddSet}>+ Add set</button>
          </div>
        </div>
      </div>
    </div>
  )
}
