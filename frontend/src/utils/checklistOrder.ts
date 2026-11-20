// The order of a card's checklists, or of a checklist's items, when the card
// dialog saves them (components/CardDialog.tsx). The server keeps what it
// had in its order and puts each new one after the last, so an order needs
// sending only when the user moved something; and the server refuses an
// order that doesn't name every one it has, including any the dialog never
// showed (a copy made onto this card, something added elsewhere).

// Whether the server's own order, once the dialog's changes are saved, is
// already the dialog's: those it had (`savedIds`, in its order) that the
// dialog still shows, then those the dialog adds, in the order it adds them
// (which is the order they appear in `shownIds`).
export function isServerOrder(savedIds: string[], shownIds: string[]): boolean {
  const saved = new Set(savedIds)
  const shown = new Set(shownIds)
  const serverOrder = [
    ...savedIds.filter((id) => shown.has(id)),
    ...shownIds.filter((id) => !saved.has(id)),
  ]
  return serverOrder.every((id, index) => id === shownIds[index])
}

// The order to send: the dialog's, then whatever else the server has
// (`serverIds`, in its order), so the server accepts it. Ids the server
// doesn't have are left out, as it would refuse them.
export function fullOrder(shownIds: string[], serverIds: string[]): string[] {
  const onServer = new Set(serverIds)
  const shown = new Set(shownIds)
  return [
    ...shownIds.filter((id) => onServer.has(id)),
    ...serverIds.filter((id) => !shown.has(id)),
  ]
}
