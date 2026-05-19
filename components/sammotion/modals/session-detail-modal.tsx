"use client"

import { useEffect, useState } from "react"
import { fmtDate, fmtDay, fmtDur, fmtVol } from "@/lib/sammotion/helpers"
import { useStore } from "@/lib/sammotion/store"
import type { HistoryEntry, HistoryExerciseLog, SetLog } from "@/lib/sammotion/types"
import { ModalSheet } from "./modal-sheet"

export function SessionDetailModal({
  open,
  onClose,
  sessionId,
}: {
  open: boolean
  onClose: () => void
  sessionId: string | null
}) {
  const { state, updateSession, deleteSession } = useStore()
  const session = sessionId ? state.history.find((h) => h.id === sessionId) : null

  const [details, setDetails] = useState<HistoryExerciseLog[]>([])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset local edit state whenever the modal opens for a new session.
  useEffect(() => {
    if (open && session) {
      setDetails(session.details ? JSON.parse(JSON.stringify(session.details)) : [])
      setEditing(false)
      setConfirmDelete(false)
    }
  }, [open, session])

  if (!session) return <ModalSheet open={open} onClose={onClose} />

  // Capture in a const so TypeScript's narrowing survives into closures below.
  const sess: HistoryEntry = session
  const isSample = sess.sample
  const totalVol = details.reduce((a, ex) => a + ex.sets.reduce((b, s) => b + (s.done ? s.weight * s.reps : 0), 0), 0)
  const totalSets = details.reduce((a, ex) => a + ex.sets.filter((s) => s.done).length, 0)

  function patchSet(ei: number, si: number, field: keyof SetLog, value: number | boolean) {
    setDetails((prev) => {
      const next = [...prev]
      const ex = { ...next[ei], sets: [...next[ei].sets] }
      ex.sets[si] = { ...ex.sets[si], [field]: value }
      next[ei] = ex
      return next
    })
  }

  function save() {
    updateSession(sess.id, { details })
    setEditing(false)
    onClose()
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteSession(sess.id)
    onClose()
  }

  return (
    <ModalSheet open={open} onClose={onClose}>
      <div className="row jb mb6">
        <div>
          <div className="t10 w7 c2 upper" style={{ letterSpacing: ".6px" }}>Session Detail</div>
          <div className="t17 w8 mt4">{sess.routine || "Workout"}</div>
        </div>
        {!isSample && !editing ? (
          <button type="button" className="bdg bdo" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      <div className="t11 c2 mb16">
        {fmtDate(sess.date)} · {fmtDay(sess.date)} · {fmtDur(sess.dur)} · {fmtVol(totalVol)}kg · {totalSets} sets
      </div>

      {isSample ? (
        <div className="sampleBanner mb12">
          <span className="t11 c2">This is a <span className="co w6">sample session</span> — log a real workout to replace it.</span>
        </div>
      ) : null}

      {details.length === 0 ? (
        <div className="t13 c2" style={{ textAlign: "center", padding: 16 }}>
          No per-set detail saved for this session.
        </div>
      ) : (
        <div className="sdetails">
          {details.map((ex, ei) => (
            <div key={`${ex.id}_${ei}`} className="sdEx">
              <div className="t13 w7 mb8">{ex.n}</div>
              {ex.notes ? (
                <div className="t11 c2 mb8" style={{ background: "var(--bg)", padding: "6px 10px", borderRadius: 8, borderLeft: "2px solid var(--orange)" }}>
                  <span className="co w7" style={{ marginRight: 4 }}>📝</span>
                  {ex.notes}
                </div>
              ) : null}
              {ex.sets.map((s, si) => (
                <div key={si} className="sdRow">
                  <span className="t10 c3 w7" style={{ width: 24 }}>{si + 1}</span>
                  {editing ? (
                    <>
                      <input
                        className="sdInp"
                        type="number"
                        step="0.5"
                        value={s.weight}
                        onChange={(e) => patchSet(ei, si, "weight", parseFloat(e.target.value) || 0)}
                      />
                      <span className="t10 c2">kg</span>
                      <input
                        className="sdInp"
                        type="number"
                        value={s.reps}
                        onChange={(e) => patchSet(ei, si, "reps", parseInt(e.target.value, 10) || 0)}
                      />
                      <span className="t10 c2">reps</span>
                      <button
                        type="button"
                        className={`chkBtn ${s.done ? "done" : ""}`}
                        onClick={() => patchSet(ei, si, "done", !s.done)}
                        aria-label={s.done ? "Mark incomplete" : "Mark complete"}
                      >
                        ✓
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="t13 mono w7">{s.weight % 1 === 0 ? s.weight : s.weight.toFixed(1)}</span>
                      <span className="t10 c2">kg ×</span>
                      <span className="t13 mono w7">{s.reps}</span>
                      <span className="t10 c2 f1">reps</span>
                      {s.done ? <span className="bdg bdg2">✓</span> : <span className="bdg" style={{background:"#222",color:"#777"}}>—</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!isSample ? (
        <div className="row g8 mt16">
          {editing ? (
            <>
              <button type="button" className="btnP f1" onClick={save}>Save Changes</button>
              <button
                type="button"
                className="btnP"
                style={{ background: "var(--card2)", color: "var(--t2)", border: "1px solid var(--border)", boxShadow: "none", flex: 0, padding: "0 16px" }}
                onClick={() => { setEditing(false); setDetails(sess.details ? JSON.parse(JSON.stringify(sess.details)) : []) }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btnP f1"
              style={{ background: confirmDelete ? "#7a1d1d" : "var(--card2)", color: confirmDelete ? "#fff" : "var(--t2)", border: "1px solid var(--border)", boxShadow: "none" }}
              onClick={handleDelete}
            >
              {confirmDelete ? "Tap again to confirm delete" : "Delete Session"}
            </button>
          )}
        </div>
      ) : null}
    </ModalSheet>
  )
}
